import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { RecordsListComponent } from './records-list/records-list.component';
import { RecordsAddEditComponent } from './records-add-edit/records-add-edit.component';
import { CanDeactivateGuard } from '../guards/can-deactivate-guard.service';
import { CanActivateGuard } from '../guards/can-activate-guard.service';
import { RecordsResolverService } from '../services/records-resolver.service';

const routes: Routes = [
  {
    path: 'records/list',
    component: RecordsListComponent,
    canActivate: [CanActivateGuard]
  },
  {
    path: 'records/add',
    component: RecordsAddEditComponent,
    canActivate: [CanActivateGuard],
    canDeactivate: [CanDeactivateGuard]
  },
  {
    path: 'records/:recordId/edit',
    component: RecordsAddEditComponent,
    canActivate: [CanActivateGuard],
    canDeactivate: [CanDeactivateGuard],
    resolve: {
      record: RecordsResolverService
    }
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
  providers: []
})
export class RecordsRoutingModule {}