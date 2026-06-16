import { Router, Route, Switch } from "wouter";
import HomePage from "./pages/HomePage";
import ExerciseListPage from "./pages/ExerciseListPage";
import SessionPage from "./pages/SessionPage";

const base = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function App() {
  return (
    <Router base={base}>
      <Switch>
        <Route path="/" component={HomePage} />
        <Route path="/exercises" component={ExerciseListPage} />
        <Route path="/session" component={SessionPage} />
        <Route>
          <HomePage />
        </Route>
      </Switch>
    </Router>
  );
}
