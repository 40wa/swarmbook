export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function appError(code: string, message: string, status = 400): AppError {
  return new AppError(code, message, status);
}
