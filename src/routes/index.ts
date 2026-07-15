import type { Route } from "../lib/types";
import home from "./home";
import account from "./account";
import loanCompare from "./loan-compare";
import blogsPaginated from "./blogs-paginated";
import recourseRedirect from "./recourse-redirect";
import retirementBanking from "./retirement-banking";
import remoteCustomerObtain from "./remote-customer-obtain";

/** The route table. Order matters: first match wins. */
export const routes: Route[] = [
  home,
  account,
  recourseRedirect,
  loanCompare,
  blogsPaginated,
  retirementBanking,
  remoteCustomerObtain,
];
