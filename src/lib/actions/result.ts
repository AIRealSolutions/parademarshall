export interface ActionResult<T = unknown> {
  ok?: boolean;
  error?: string;
  data?: T;
}
