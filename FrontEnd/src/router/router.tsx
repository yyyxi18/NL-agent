import { createHashRouter, Navigate } from 'react-router';
import App from '../view/App';
import Home from '../view/Home';
import Worklogs from '../view/Worklogs';
import ComingSoon from '../view/ComingSoon';
import ErrorPage from '../view/ErrorPage';

export const router = createHashRouter([
  {
    path: '/',
    element: <App />,
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <Home /> },
      { path: 'worklogs', element: <Worklogs /> },
      { path: 'reports', element: <ComingSoon title="結案報告製作" /> },
      { path: 'sow', element: <ComingSoon title="SOW 撰寫" /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
