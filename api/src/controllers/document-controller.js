const mongoose = require('mongoose');
const queryActions = require('../utils/query-actions');
const { uuid } = require('uuidv4');
const AWS = require('aws-sdk');
const mongodb = require('../utils/mongodb');
const ObjectID = require('mongodb').ObjectID;

const OBJ_STORE_URL = process.env.OBJECT_STORE_endpoint_url || 'nrs.objectstore.gov.bc.ca';
const ep = new AWS.Endpoint(OBJ_STORE_URL);
const s3 = new AWS.S3({
  endpoint: ep,
  accessKeyId: process.env.OBJECT_STORE_user_account,
  secretAccessKey: process.env.OBJECT_STORE_password,
  signatureVersion: 'v4'
});

exports.protectedOptions = function (args, res, next) {
  res.status(200).send();
};

exports.protectedPost = async function (args, res, next) {
  if (
    args.swagger.params.data &&
    args.swagger.params.data.value &&
    args.swagger.params.recordId &&
    args.swagger.params.recordId.value
  ) {
    let data = args.swagger.params.data.value;
    let docResponse;

    if (data.url) {
      // If the document already has a url we can assume it's a link
      try {
        docResponse = await createLinkDocument(
          data.fileName,
          (this.auth_payload && this.auth_payload.displayName) || '',
          data.url
        )
      } catch (e) {
        return queryActions.sendResponse(res, 400, e);
      }
    } else {
      // TODO: If it doesn't then we are uploading to S3.
    }
    // Now we must update the associated record.
    try {
      const db = mongodb.connection.db(process.env.MONGODB_DATABASE || 'nrpti-dev');
      const collection = db.collection('nrpti');

      const recordResponse = await collection.findOneAndUpdate(
        { _id: new ObjectID(args.swagger.params.recordId.value) },
        { $addToSet: { documents: new ObjectID(docResponse._id) } },
        { returnNewDocument: true }
      );

      return queryActions.sendResponse(res, 200, { document: docResponse, record: recordResponse });
    } catch (e) {
      return queryActions.sendResponse(res, 400, e);
    }
  } else {
    return queryActions.sendResponse(res, 400, { error: 'You must provide data and recordId' });
  }
};

// WIP
exports.protectedPut = async function (args, res, next) {
  if (args.swagger.params.data && args.swagger.params.data.value) {
    const data = args.swagger.params.data.value;

    if (!data.fileName) {
      return queryActions.sendResponse(res, 400, 'You must have a file name');
    }

    const Document = mongoose.model('Document');
    let document = new Document();
    const key = `${uuid()}_${data.fileName}`;

    document.fileName = data.fileName;
    document.key = key;
    document._addedBy = args.swagger.params.auth_payload.displayName;

    let savedDocument = null;
    try {
      savedDocument = await document.save();
    } catch (e) {
      return queryActions.sendResponse(res, 400, e);
    }

    try {
      const url = redirect('PUT', key);
      return queryActions.sendResponse(res, 200, { document: savedDocument, presignedData: url });
    } catch (e) {
      return queryActions.sendResponse(res, 400, e);
    }
  } else {
    return queryActions.sendResponse(res, 400, { error: 'You must provide data' });
  }
};

exports.protectedDelete = async function (args, res, next) {
  if (
    args.swagger.params.docId &&
    args.swagger.params.docId.value &&
    args.swagger.params.recordId &&
    args.swagger.params.recordId.value
  ) {
    // First we want to delete the document.
    const Document = mongoose.model('Document');
    let docResponse;
    try {
      docResponse = await Document.deleteOne({ _id: new ObjectID(args.swagger.params.docId.value) });
    } catch (e) {
      return queryActions.sendResponse(res, 400, e);
    }

    // Then we want to remove the document's id from the record it's attached to.
    try {
      const db = mongodb.connection.db(process.env.MONGODB_DATABASE || 'nrpti-dev');
      const collection = db.collection('nrpti');

      const recordResponse = await collection.findOneAndUpdate(
        { _id: new ObjectID(args.swagger.params.recordId.value) },
        { $pull: { documents: new ObjectID(docResponse._id) } },
        { returnNewDocument: true }
      );

      return queryActions.sendResponse(res, 200, { document: docResponse, record: recordResponse });
    } catch (e) {
      return queryActions.sendResponse(res, 400, e);
    }
  } else {
    return queryActions.sendResponse(res, 400, { error: 'You must provide docId and recordId' });
  }
}

exports.createLinkDocument = createLinkDocument;

async function createLinkDocument(fileName, addedBy, url) {
  const Document = mongoose.model('Document');
  let document = new Document();
  document.fileName = fileName;
  document.addedBy = addedBy;
  document.url = url;
  document.read = ['public', 'sysadmin'];
  document.write = ['sysadmin'];
  return await document.save();
}

// WIP
function createSignedUrl(operation, key) {
  let params = {
    Bucket: process.env.OBJECT_STORE_bucket_name,
    Key: key,
    Expires: 5 * 60 // Link expires in 5 minutes
  };

  try {
    if (operation === 'postObject') {
      return s3.createPresignedPost(params);
    } else {
      return s3.getSignedUrl(operation, params);
    }
  } catch (e) {
    throw new Error(`Unable to genereate presigned post url. ${e}`);
  }
}

// WIP
function redirect(method, key) {
  let operation;
  switch (method) {
    case 'GET':
      operation = 'getObject';
      break;
    case 'HEAD':
      operation = 'headObject';
      break;
    case 'POST':
      operation = 'postObject';
      break;
    case 'PUT':
      operation = 'putObject';
      break;
    case 'DELETE':
      operation = 'deleteObject';
      break;
    default:
      throw new Error(`Invalid method operation ${method}`);
  }

  return createSignedUrl(operation, key);
}
