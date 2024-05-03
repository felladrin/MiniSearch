import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';

import { SearchPage } from "../pages/search/SearchPage";
import { ComparisonPage } from "../pages/static/ComparisonPage";

function InnerApp() {

  return (
    <>
      <Routes>
        <Route path="/" element={<SearchPage />} />
        <Route path="/comparison-google" element={<ComparisonPage />} />
      </Routes>
    </>
  );
}

export const App = () => {
  return (
    <Router>
      <InnerApp />
    </Router>
  );
}
