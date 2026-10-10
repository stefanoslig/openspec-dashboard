// How we talk to GitHub: the GraphQL endpoint, the shapes it answers with, and how a refusal is
// worded.

/** Where and as whom to reach GitHub. */
export interface ConnectOptions {
  /** The GraphQL endpoint, https://api.github.com/graphql on github.com. */
  graphqlUrl: string;
  token: string;
  /** owner/name */
  repository: string;
  fetch?: typeof fetch;
}
/** A repository on a connected GitHub. */
export interface GitHubApi {
  owner: string;
  name: string;
  /** The `data` of one GraphQL query; throws with the reason when GitHub does not answer with data. */
  query<T>(query: string, variables: Record<string, unknown>): Promise<T>;
}

export interface Page<T> {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: T[];
}
export interface ChangedFile {
  path: string;
  changeType: string;
}
export interface Thread {
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  line: number | null;
  diffSide: string;
  subjectType: string;
  comments: {
    totalCount: number;
    nodes: { author: { login: string } | null; body: string; createdAt: string; url: string }[];
  };
}
export interface PullRequestNode {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  isCrossRepository: boolean;
  author: { login: string } | null;
  headRefName: string;
  headRefOid: string;
  updatedAt: string;
  files: Page<ChangedFile> | null;
  reviewThreads: Page<Thread>;
}
/** One entry of a git tree. */
export interface Entry {
  name: string;
  type: string;
  mode: number;
  oid: string;
  size: number;
}
/** A decoded answer: GraphQL data or errors, or a bare message when the request got no further. */
export interface GraphQLBody {
  data?: unknown;
  message?: string;
  errors?: { type?: string; message: string }[];
}

const permissions =
  ' The workflow needs the permissions "contents: read" and "pull-requests: read".';

/** GitHub's first word on what went wrong, or empty when it gave none. */
const problemOf = (body: GraphQLBody) => body.errors?.[0]?.message ?? body.message ?? '';
const isForbidden = (status: number, body: GraphQLBody) =>
  [401, 403].includes(status) || body.errors?.some((error) => error.type === 'FORBIDDEN');

/** Why GitHub did not answer with data, from the HTTP status, its text and the decoded body. */
export function failureMessage(status: number, statusText: string, body: GraphQLBody): string {
  const problem = problemOf(body);
  // GraphQL errors arrive with a 2xx status, which says nothing worth repeating.
  const answered = status >= 200 && status < 300 ? 'GitHub answered' : `GitHub answered ${status}`;
  // A refusal means a missing permission, unless the token merely hit the rate limit.
  const hint = isForbidden(status, body) && !/rate limit/i.test(problem) ? permissions : '';
  return `${answered}: ${problem || statusText}`.replace(/[.:\s]*$/, '.') + hint;
}

async function send(
  options: ConnectOptions,
  query: string,
  variables: Record<string, unknown>,
): Promise<Response> {
  const request = options.fetch ?? fetch;
  try {
    return await request(options.graphqlUrl, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + options.token,
        'Content-Type': 'application/json',
        'User-Agent': 'openspec-desk',
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (error) {
    throw new Error('GitHub could not be reached: ' + (error as Error).message, { cause: error });
  }
}

/** The `data` of a GraphQL response, or the reason there is none. */
async function decode<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as GraphQLBody;
  if (!response.ok || body.errors?.length)
    throw new Error(failureMessage(response.status, response.statusText, body));
  if (!body.data) throw new Error('GitHub answered with something other than GraphQL data.');
  return body.data as T;
}

export function connect(options: ConnectOptions): GitHubApi {
  const [owner, name] = options.repository.split('/');
  const query = async <T>(text: string, variables: Record<string, unknown>) =>
    decode<T>(await send(options, text, variables));
  return { owner, name, query };
}
