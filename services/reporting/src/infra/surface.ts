import {
  badRequest,
  forbidden,
  notFound,
  ok,
  unauthorized,
  type ServiceSurface,
} from "@runsheet/api";

export const reportingSurface: ServiceSurface = {
  service: "reporting",
  operations: [
    {
      method: "GET",
      path: "/v1/reports",
      summary: "List the reports that can be run, and what each one shows",
      scope: "reports:read",
      replies: [ok("the reports, their columns, and whether they take a hub"), unauthorized],
    },
    {
      method: "GET",
      path: "/v1/reports/:name",
      summary: "Run a report over a date range, as data or as a file",
      scope: "reports:read",
      replies: [
        ok("the rows, or a comma-separated file when one was asked for"),
        badRequest,
        unauthorized,
        forbidden,
        notFound,
      ],
    },
  ],
};
