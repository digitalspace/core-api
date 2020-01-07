var _ = require('lodash');
var defaultLog = require('winston').loggers.get('default');
var mongoose = require('mongoose');
var Actions = require('../utils/actions');
var Utils = require('../utils/utils');
var qs = require('qs');
var mongodb = require('../utils/mongodb');

function isEmpty(obj) {
  for (var key in obj) {
    if (obj.hasOwnProperty(key))
      return false;
  }
  return true;
}

var generateExpArray = async function (field, roles) {
  var expArray = [];
  if (field && field != undefined) {
    var queryString = qs.parse(field);
    defaultLog.info("queryString:", queryString);
    // Note that we need map and not forEach here because Promise.all uses
    // the returned array!
    return await Promise.all(Object.keys(queryString).map(async item => {
      var entry = queryString[item];
      defaultLog.info("item:", item, entry);
      if (Array.isArray(entry)) {
        // Arrays are a list of options so will always be ors
        var orArray = entry.map(element => {
          return getConvertedValue(item, element);
        });
        return { $or: orArray };
      } else {
        switch (item) {
          case 'decisionDateStart':
            return handleDateStartItem('decisionDate', entry);
          case 'decisionDateEnd':
            return handleDateEndItem('decisionDate', entry);
          case 'datePostedStart':
            return handleDateStartItem('datePosted', entry);
          case 'datePostedEnd':
            return handleDateEndItem('datePosted', entry);
          default:
            return getConvertedValue(item, entry);
        }
      }
    }));
  }
}

var getConvertedValue = function (item, entry) {
  if (isNaN(entry)) {
    if (mongoose.Types.ObjectId.isValid(entry)) {
      defaultLog.info("objectid", entry);
      // ObjectID
      return { [item]: mongoose.Types.ObjectId(entry) };
    } else if (entry === 'true') {
      defaultLog.info("bool");
      // Bool
      var tempObj = {}
      tempObj[item] = true;
      tempObj.active = true;
      return tempObj;
    } else if (entry === 'false') {
      defaultLog.info("bool");
      // Bool
      return { [item]: false };
    } else {
      defaultLog.info("string");
      return { [item]: entry };
    }
  } else {
    defaultLog.info("number");
    return { [item]: parseInt(entry) };
  }
}

var handleDateStartItem = function (expArray, field, entry) {
  var date = new Date(entry);

  // Validate: valid date?
  if (!isNaN(date)) {
    var start = new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    return { [field]: { $gte: start } };
  }
}

var handleDateEndItem = function (expArray, field, entry) {
  var date = new Date(entry);

  // Validate: valid date?
  if (!isNaN(date)) {
    var end = new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
    return { [field]: { $lt: end } };
  }
}

var searchCollection = async function (roles, keywords, schemaName, pageNum, pageSize, project, sortField = undefined, sortDirection = undefined, caseSensitive, populate = false, and, or) {
  var properties = undefined;
  if (project) {
    properties = { project: mongoose.Types.ObjectId(project) };
  }

  // optional search keys
  var searchProperties = undefined;
  if (keywords) {
    searchProperties = { $text: { $search: keywords, $caseSensitive: caseSensitive } };
  }

  // query modifiers
  var andExpArrayProcess = await generateExpArray(and, roles);
  var andExpArray = [];

  // Pluck the _epicProjectId from the array if a flavour record query is coming in.
  let _epicProjectId = '';
  const flavourRecords = ['OrderLNG', 'InspectionLNG', 'PlanLNG', 'AuthorizationLNG', 'NationLNG'];

  if (schemaName.some(item => flavourRecords.includes(item))) {
    for(i = 0;i < andExpArrayProcess.length; i++) {
      const obj = andExpArrayProcess[i];
      if (obj && obj._epicProjectId) {
        _epicProjectId = mongoose.Types.ObjectId(obj._epicProjectId);
      } else {
        andExpArray.push(obj);
      }
    }
  } else {
    // No plucking required
    andExpArray = andExpArrayProcess;
  }

  // filters
  var orExpArray = await generateExpArray(or, roles);

  var modifier = {};
  if (andExpArray.length > 0 && orExpArray.length > 0) {
    modifier = { $and: [{ $and: andExpArray }, { $and: orExpArray }] };
  } else if (andExpArray.length === 0 && orExpArray.length > 0) {
    modifier = { $and: orExpArray };
  } else if (andExpArray.length > 0 && orExpArray.length === 0) {
    modifier = { $and: andExpArray };
  }

  var match = {
    _schemaName: Array.isArray(schemaName) ? { $in: schemaName } : schemaName,
    ...(isEmpty(modifier) ? undefined : modifier),
    ...(searchProperties ? searchProperties : undefined),
    ...(properties ? properties : undefined),
    $or: [
      { isDeleted: { $exists: false } },
      { isDeleted: false },
    ]
  };

  defaultLog.info("modifier:", modifier);
  defaultLog.info("match:", match);

  var sortingValue = {};
  sortingValue[sortField] = sortDirection;

  let searchResultAggregation = [];
  // We don't want to have sort in the aggregation if the front end doesn't need sort.
  if (sortField && sortDirection) {
    searchResultAggregation.push(
      {
        $sort: sortingValue
      }
    );
  }
  searchResultAggregation.push(
    {
      $skip: pageNum * pageSize
    },
    {
      $limit: pageSize
    }
  );


  var aggregation = [
    {
      $match: match
    }
  ];

  let collation = {
    locale: 'en',
    strength: 2
  };

  defaultLog.info('collation:', collation);

  // This only happens when we are getting queried from the LNG flavour perspective.
  if (schemaName.some(item => flavourRecords.includes(item))) {
    // Grab the master record that's backreferenced to these ones.
    aggregation.push({
      "$lookup": {
        "from": "nrpti",
        "localField": "_master",
        "foreignField": "_id",
        "as": "_master"
      }
    });
    aggregation.push({
      "$match": {
        "_master._epicProjectId": _epicProjectId
      },
    });
    aggregation.push({
      "$unwind": {
        "path": "$_master",
        "preserveNullAndEmptyArrays": true
      }
    });
  };

  aggregation.push({
    $redact: {
      $cond: {
        if: {
          // This way, if read isn't present, we assume public no roles array.
          $and: [
            { $cond: { if: "$read", then: true, else: false } },
            {
              $anyElementTrue: {
                $map: {
                  input: "$read",
                  as: "fieldTag",
                  in: { $setIsSubset: [["$$fieldTag"], roles] }
                }
              }
            }
          ]
        },
        then: "$$KEEP",
        else: {
          $cond: { if: "$read", then: "$$PRUNE", else: "$$DESCEND" }
        }
      }
    }
  });

  aggregation.push({
    $addFields: {
      score: { $meta: "textScore" }
    }
  });

  aggregation.push({
    $facet: {
      searchResults: searchResultAggregation,
      meta: [
        {
          $count: "searchResultsTotal"
        }
      ]
    }
  })

  defaultLog.info("Executing searching on schema(s):", schemaName);

  const db = mongodb.connection.db(process.env.MONGODB_DATABASE || 'nrpti-dev');
  const collection = db.collection('nrpti');
  return collection.aggregate(aggregation).toArray();
}

exports.publicGet = async function (args, res, next) {
  executeQuery(args, res, next);
};

exports.protectedGet = function (args, res, next) {
  executeQuery(args, res, next);
};

var executeQuery = async function (args, res, next) {
  var _id = args.swagger.params._id ? args.swagger.params._id.value : null;
  var keywords = args.swagger.params.keywords.value;
  var dataset = args.swagger.params.dataset.value;
  var project = args.swagger.params.project.value;
  var populate = args.swagger.params.populate ? args.swagger.params.populate.value : false;
  var pageNum = args.swagger.params.pageNum.value || 0;
  var pageSize = args.swagger.params.pageSize.value || 25;
  var sortBy = args.swagger.params.sortBy.value ? args.swagger.params.sortBy.value : keywords ? ['-score'] : [];
  var caseSensitive = args.swagger.params.caseSensitive ? args.swagger.params.caseSensitive.value : false;
  var and = args.swagger.params.and ? args.swagger.params.and.value : '';
  var or = args.swagger.params.or ? args.swagger.params.or.value : '';
  defaultLog.info("Searching keywords:", keywords);
  defaultLog.info("Searching datasets:", dataset);
  defaultLog.info("Searching project:", project);
  defaultLog.info("pageNum:", pageNum);
  defaultLog.info("pageSize:", pageSize);
  defaultLog.info("sortBy:", sortBy);
  defaultLog.info("caseSensitive:", caseSensitive);
  defaultLog.info("and:", and);
  defaultLog.info("or:", or);
  defaultLog.info("_id:", _id);
  defaultLog.info("populate:", populate);

  var roles = args.swagger.params.auth_payload ? args.swagger.params.auth_payload.realm_access.roles : ['public'];

  defaultLog.info("Searching Collection:", dataset);

  defaultLog.info("******************************************************************");
  defaultLog.info(roles);
  defaultLog.info("******************************************************************");

  Utils.recordAction('Search', keywords, args.swagger.params.auth_payload ? args.swagger.params.auth_payload.preferred_username : 'public')

  var sortDirection = undefined;
  var sortField = undefined;

  var sortingValue = {};
  sortBy.map((value) => {
    sortDirection = value.charAt(0) == '-' ? -1 : 1;
    sortField = value.slice(1);
    sortingValue[sortField] = sortDirection;
  });

  defaultLog.info("sortingValue:", sortingValue);
  defaultLog.info("sortField:", sortField);
  defaultLog.info("sortDirection:", sortDirection);

  if (dataset[0] !== 'Item') {

    defaultLog.info("Searching Dataset:", dataset);
    defaultLog.info("sortField:", sortField);

    let itemData = await searchCollection(roles, keywords, dataset, pageNum, pageSize, project, sortField, sortDirection, caseSensitive, populate, and, or)

    return Actions.sendResponse(res, 200, itemData);

  } else if (dataset[0] === 'Item') {
    var collectionObj = mongoose.model(args.swagger.params._schemaName.value);
    defaultLog.info("ITEM GET", { _id: args.swagger.params._id.value })

    let aggregation = [
      {
        "$match": { _id: mongoose.Types.ObjectId(args.swagger.params._id.value) }
      },
      {
        $redact: {
          $cond: {
            if: {
              // This way, if read isn't present, we assume public no roles array.
              $and: [
                { $cond: { if: "$read", then: true, else: false } },
                {
                  $anyElementTrue: {
                    $map: {
                      input: "$read",
                      as: "fieldTag",
                      in: { $setIsSubset: [["$$fieldTag"], roles] }
                    }
                  }
                }
              ]
            },
            then: "$$KEEP",
            else: {
              $cond: { if: "$read", then: "$$PRUNE", else: "$$DESCEND" }
            }
          }
        }
      }
    ];

    var data = await collectionObj.aggregate(aggregation);

    if (args.swagger.params._schemaName.value === 'Project') {
      // If we are a project, and we are not authed, we need to sanitize some fields.
      data = Utils.filterData(args.swagger.params._schemaName.value, data, roles);
    }
    return Actions.sendResponse(res, 200, data);
  } else {
    defaultLog.info('Bad Request');
    return Actions.sendResponse(res, 400, {});
  }
};

exports.protectedOptions = function (args, res, next) {
  res.status(200).send();
};
