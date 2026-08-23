import type { Route } from "@originloom/react/lib/types";

import account from "./account";
import bankDetail from "./bank-detail";
import bist100 from "./bist100";
import creditCardComparison from "./credit-card-comparison";
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
import previewDemo from "./preview-demo";
import recourseRedirect from "./recourse-redirect";
import remoteCustomerObtain from "./remote-customer-obtain";
import serverIsland from "./server-island";

/** The route table. Order matters: first match wins. */
export const routes: Route[] = [
  home,
  serverIsland,
  previewDemo,
  housingLoans,
  housingLoanDetail,
  creditCards,
  creditCardDetail,
  creditCardComparison,
  loanCalculator,
  bankDetail,
  knowledgeCenter,
  knowledgeArticle,
  bist100,
  financeReferral,
  account,
  recourseRedirect,
  mediaPipeline,
  remoteCustomerObtain,
];
