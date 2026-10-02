export interface Artifact {
  path: string;
  title: string;
  content: string;
  format: 'markdown' | 'yaml';
  modified: string | null;
  revision: string;
  completed: number;
  total: number;
  requirements: number;
  scenarios: number;
  summary: string;
}
export interface Change {
  id: string;
  name: string;
  title: string;
  archived: boolean;
  schema: string;
  status: 'Draft' | 'Planned' | 'In progress' | 'Complete';
  completed: number;
  total: number;
  summary: string;
  modified: string | null;
  documents: string[];
}
export interface Workspace {
  name: string;
  root: string;
  isDemo: boolean;
  source?: {
    provider: 'github';
    repository: string;
    ref: string;
    commit: string;
    committedAt: string | null;
    folder: string;
    url: string;
  };
  schema: string;
  loadedAt: string;
  documents: Artifact[];
  changes: Change[];
  warnings: string[];
  specs: { path: string; capability: string; requirements: number; scenarios: number }[];
}
