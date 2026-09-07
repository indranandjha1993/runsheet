import type { ServiceSurface } from "@runsheet/api";
import { addressSurface } from "@runsheet/address";
import { exceptionsSurface } from "@runsheet/exceptions";
import { executionSurface } from "@runsheet/execution";
import { identitySurface } from "@runsheet/identity";
import { linehaulSurface } from "@runsheet/linehaul";
import { moneySurface } from "@runsheet/money";
import { networkSurface } from "@runsheet/network";
import { ordersSurface } from "@runsheet/orders";
import { planningSurface } from "@runsheet/planning";
import { policySurface } from "@runsheet/policy";
import { promiseSurface } from "@runsheet/promise";
import { reportingSurface } from "@runsheet/reporting";

export const SURFACES: readonly ServiceSurface[] = [
  identitySurface,
  networkSurface,
  addressSurface,
  ordersSurface,
  executionSurface,
  linehaulSurface,
  planningSurface,
  promiseSurface,
  exceptionsSurface,
  moneySurface,
  policySurface,
  reportingSurface,
];
