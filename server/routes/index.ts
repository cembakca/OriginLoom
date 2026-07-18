import type { Route } from "~/lib/types";

import account from "./account";
import blogsPaginated from "./blogs-paginated";
import blogsPaginatedStreaming from "./blogs-paginated-streaming";
import blogsPopularFragments from "./blogs-popular-streaming";
import creditCardDetail from "./credit-card-detail";
import creditCards from "./credit-cards";
import home from "./home";
import housingLoanDetail from "./housing-loan-detail";
import housingLoans from "./housing-loans";
import loanCompare from "./loan-compare";
import mediaPipeline from "./media-pipeline";
import recourseRedirect from "./recourse-redirect";
import remoteCustomerObtain from "./remote-customer-obtain";
import retirementBanking from "./retirement-banking";

/** The route table. Order matters: first match wins. */
export const routes: Route[] = [
  home,
  housingLoans,
  housingLoanDetail,
  creditCards,
  creditCardDetail,
  account,
  recourseRedirect,
  loanCompare,
  mediaPipeline,
  blogsPaginated,
  blogsPaginatedStreaming,
  blogsPopularFragments,
  retirementBanking,
  remoteCustomerObtain,
];
