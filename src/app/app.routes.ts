import { Routes } from '@angular/router';
export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./features/dashboard/dashboard').then((m) => m.Dashboard),
    title: 'Workspace · OpenSpec Desk',
  },
  {
    path: 'artifact',
    loadComponent: () => import('./features/reader/reader').then((m) => m.Reader),
    title: 'Artifact · OpenSpec Desk',
  },
  { path: '**', redirectTo: '' },
];
