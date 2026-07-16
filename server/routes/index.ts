import type { Route } from "~/lib/types";

import account from "./account";
import blogsPaginated from "./blogs-paginated";
import home from "./home";
import loanCompare from "./loan-compare";
import recourseRedirect from "./recourse-redirect";
import remoteCustomerObtain from "./remote-customer-obtain";
import retirementBanking from "./retirement-banking";

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
