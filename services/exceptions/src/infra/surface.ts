import {
  badRequest,
  conflict,
  created,
  notFound,
  ok,
  unauthorized,
  type ServiceSurface,
} from "@runsheet/api";
import { observedBody, workBody } from "./routes.js";

export const exceptionsSurface: ServiceSurface = {
  service: "exceptions",
  operations: [
    {
      method: "POST",
      path: "/v1/observations",
      summary: "Report something that looks wrong",
      scope: "runs:write",
      request: observedBody,
      replies: [created("the exception, raised or already open"), badRequest, unauthorized],
    },
    {
      method: "POST",
      path: "/v1/exceptions/:id/events",
      summary: "Work an exception",
      scope: "runs:write",
      request: workBody,
      replies: [ok("the exception after the event"), badRequest, unauthorized, notFound, conflict],
    },
    {
      method: "GET",
      path: "/v1/exceptions",
      summary: "List the open exceptions",
      scope: "runs:read",
      replies: [ok("the open exceptions, worst first"), unauthorized],
    },
    {
      method: "GET",
      path: "/v1/exceptions/:id",
      summary: "Read an exception",
      scope: "runs:read",
      replies: [ok("the exception"), unauthorized, notFound],
    },
  ],
};
