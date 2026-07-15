import type { Route } from "../lib/types";
import home from "./home";
import account from "./account";
import loanCompare from "./loan-compare";
import blogsPaginated from "./blogs-paginated";

/** The route table. Order matters: first match wins. */
export const routes: Route[] = [home, account, loanCompare, blogsPaginated];
