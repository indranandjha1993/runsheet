import {
  badRequest,
  created,
  notFound,
  ok,
  unauthorized,
  type ServiceSurface,
} from "@runsheet/api";
import { planBody } from "./routes.js";

export const planningSurface: ServiceSurface = {
  service: "planning",
  operations: [
    {
      method: "POST",
      path: "/v1/plans",
      summary: "Ask for a plan for a hub and a day",
      scope: "plans:write",
      request: planBody,
      replies: [created("the plan, its runs, and what would not fit"), badRequest, unauthorized],
    },
    {
      method: "GET",
      path: "/v1/plans/:hubId/:date",
      summary: "Read the plan for a hub and a day",
      scope: "plans:read",
      replies: [ok("the plan"), unauthorized, notFound],
    },
  ],
};
