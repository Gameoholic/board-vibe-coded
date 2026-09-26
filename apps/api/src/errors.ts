/** An error the command layer throws to signal a specific HTTP status to the route handler. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const notFound = (what: string) => new ApiError(404, `${what} not found`);
export const badRequest = (message: string) => new ApiError(400, message);
