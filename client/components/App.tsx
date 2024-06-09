import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { Main } from "./Main";

const router = createBrowserRouter([
  {
    path: "/",
    element: <Main />,
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
