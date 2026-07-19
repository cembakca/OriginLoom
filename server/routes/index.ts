import type { Route } from "~/lib/types";

import account from "./account";
import bist100 from "./bist100";
import creditCardDetail from "./credit-card-detail";
import creditCards from "./credit-cards";
import financeReferral from "./finance-referral";
import home from "./home";
import housingLoanDetail from "./housing-loan-detail";
import housingLoans from "./housing-loans";
import knowledgeArticle from "./knowledge-article";
import knowledgeCenter from "./knowledge-center";
import loanCalculator from "./loan-calculator";
import mediaPipeline from "./media-pipeline";
import recourseRedirect from "./recourse-redirect";
import remoteCustomerObtain from "./remote-customer-obtain";

/** The route table. Order matters: first match wins. */
export const routes: Route[] = [
  home,
  housingLoans,
  housingLoanDetail,
  creditCards,
  creditCardDetail,
  loanCalculator,
  knowledgeCenter,
  knowledgeArticle,
  bist100,
  financeReferral,
  account,
  recourseRedirect,
  mediaPipeline,
  remoteCustomerObtain,
];
