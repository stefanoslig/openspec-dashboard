/** An error the dashboard reports to its reader: the server sends it as its status and message. */
export class WorkspaceError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
