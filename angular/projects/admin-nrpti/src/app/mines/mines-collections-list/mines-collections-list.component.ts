import { Location } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Params, Router } from '@angular/router';
import {
  IColumnObject,
  IPageSizePickerOption,
  ITableMessage,
  LoadingScreenService,
  TableObject,
  TableTemplateUtils,
  Utils
} from 'nrpti-angular-components';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { MinesCollectionsTableRowComponent } from '../mines-collections-rows/mines-collections-table-row.component';
import { Mine } from '../../../../../common/src/app/models/bcmi/mine';

/**
 * Mine list page component.
 *
 * @export
 * @class MinesCollectionsListComponent
 * @implements {OnInit}
 * @implements {OnDestroy}
 */
@Component({
  selector: 'app-mines-collections-list',
  templateUrl: './mines-collections-list.component.html',
  styleUrls: ['./mines-collections-list.component.scss']
})
export class MinesCollectionsListComponent implements OnInit, OnDestroy {
  private ngUnsubscribe: Subject<boolean> = new Subject<boolean>();

  public mine: Mine;

  public tableData: TableObject = new TableObject({
    component: MinesCollectionsTableRowComponent,
    pageSize: 25,
    currentPage: 1,
    sortBy: '-dateAdded'
  });
  public tableColumns: IColumnObject[] = [
    {
      name: 'Collection Name',
      value: 'name',
      width: 'col-3'
    },
    {
      name: 'Agency',
      value: 'agency',
      width: 'col-1'
    },
    {
      name: 'Type',
      value: 'type',
      width: 'col-2'
    },
    {
      name: 'Date',
      value: 'date',
      width: 'col-2'
    },
    {
      name: '# of Records',
      value: 'countrecords',
      width: 'col-1'
    },
    {
      name: 'Publish State',
      value: 'published',
      width: 'col-2'
    },
    {
      name: '', // Buttons
      width: 'col-1',
      nosort: true
    }
  ];

  public queryParams: Params;

  constructor(
    public location: Location,
    public router: Router,
    public route: ActivatedRoute,
    public utils: Utils,
    private loadingScreenService: LoadingScreenService,
    private tableTemplateUtils: TableTemplateUtils,
    private _changeDetectionRef: ChangeDetectorRef
  ) {}

  /**
   * Component init.
   *
   * @memberof MinesCollectionsListComponent
   */
  ngOnInit(): void {
    this.loadingScreenService.setLoadingState(true, 'body');

    this.route.params.pipe(takeUntil(this.ngUnsubscribe)).subscribe((params: Params) => {
      this.queryParams = { ...params };
      // Get params from route, shove into the tableTemplateUtils so that we get a new dataset to work with.
      this.tableData = this.tableTemplateUtils.updateTableObjectWithUrlParams(params, this.tableData);

      if (!this.queryParams || !Object.keys(this.queryParams).length) {
        // Only need to manually set url params if this page loads using default parameters (IE: user navigates to this
        // component for the first time).
        this.setInitialURLParams();
      }

      this.route.data.pipe(takeUntil(this.ngUnsubscribe)).subscribe((res: any) => {
        if (!res || !res.collections || !res.mine) {
          alert("Uh-oh, couldn't load NRPTI mines collections");
          this.loadingScreenService.setLoadingState(false, 'body');
          return;
        }

        this.mine = res.mine[0] && res.mine[0].data && new Mine(res.mine[0].data);

        const collections =
          (res.collections[0] && res.collections[0].data && res.collections[0].data.searchResults) || [];
        this.tableData.items = collections.map(record => {
          return { rowData: record };
        });

        this.tableData.totalListItems =
          (res.collections[0] &&
            res.collections[0].data &&
            res.collections[0].data.meta &&
            res.collections[0].data.meta[0] &&
            res.collections[0].data.meta[0].searchResultsTotal) ||
          0;

        this.tableData.columns = this.tableColumns;

        this.loadingScreenService.setLoadingState(false, 'body');
        this._changeDetectionRef.detectChanges();
      });

      this._changeDetectionRef.detectChanges();
    });
  }

  /**
   * Resets sortBy to the default.
   *
   * @memberof MinesCollectionsListComponent
   */
  resetSortBy() {
    this.tableData.sortBy = '-dateAdded';
    this.queryParams['sortBy'] = '-dateAdded';
  }

  /**
   * Updates the url parameters based on the currently set query and table template params, without reloading the page.
   *
   * @memberof MinesCollectionsListComponent
   */
  setInitialURLParams() {
    this.location.go(
      this.router
        .createUrlTree(
          ['../collections', { ...this.queryParams, ...this.tableTemplateUtils.getNavParamsObj(this.tableData) }],
          {
            relativeTo: this.route
          }
        )
        .toString()
    );
  }

  /**
   * Receives messages from the table template component, and performs any corresponding actions.
   *
   * @param {ITableMessage} msg
   * @memberof MinesCollectionsListComponent
   */
  onMessageOut(msg: ITableMessage) {
    switch (msg.label) {
      case 'columnSort':
        this.setColumnSort(msg.data);
        break;
      case 'pageNum':
        this.onPageNumUpdate(msg.data);
        break;
      case 'pageSize':
        this.onPageSizeUpdate(msg.data);
        break;
      default:
        break;
    }
  }

  /**
   * Column sorting handler.
   *
   * @param {*} column
   * @memberof MinesCollectionsListComponent
   */
  setColumnSort(column) {
    if (this.tableData.sortBy.charAt(0) === '+') {
      this.tableData.sortBy = '-' + column;
    } else {
      this.tableData.sortBy = '+' + column;
    }
    this.submit();
  }

  /**
   * Page number changed (pagination).
   *
   * @param {*} pageNumber
   * @memberof MinesCollectionsListComponent
   */
  onPageNumUpdate(pageNumber) {
    this.tableData.currentPage = pageNumber;
    this.submit();
  }

  /**
   * Page size picker option selected handler.
   *
   * @param {IPageSizePickerOption} pageSize
   * @memberof MinesCollectionsListComponent
   */
  onPageSizeUpdate(pageSize: IPageSizePickerOption) {
    this.tableData.pageSize = pageSize.value;
    this.submit();
  }

  /**
   * Update mine table with latest values (whatever is set in this.tableData).
   *
   * @memberof MinesCollectionsListComponent
   */
  submit() {
    // These are params that should be handled by tableData
    delete this.queryParams.sortBy;
    delete this.queryParams.currentPage;
    delete this.queryParams.pageNumber;
    delete this.queryParams.pageSize;

    this.loadingScreenService.setLoadingState(true, 'body');

    this.router.navigate(
      ['../collections', { ...this.queryParams, ...this.tableTemplateUtils.getNavParamsObj(this.tableData) }],
      {
        relativeTo: this.route
      }
    );
  }

  /**
   * Navigate to collection add-edit page.
   *
   * @memberof MinesCollectionsListComponent
   */
  addCollection() {
    this.router.navigate(['collections', 'add']);
  }

  /**
   * Cleanup on component destroy.
   *
   * @memberof MinesCollectionsListComponent
   */
  ngOnDestroy(): void {
    this.loadingScreenService.setLoadingState(false, 'body');

    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }
}