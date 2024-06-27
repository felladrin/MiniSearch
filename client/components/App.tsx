import { Route } from "wouter";
import { Main } from "./Main";

export function App() {
  return <Route path="/" component={Main} />;
}
