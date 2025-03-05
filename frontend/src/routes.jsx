import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import UserEvaluation from './components/UserEvaluation';
import EvaluationManagement from './components/EvaluationManagement';

const AppRoutes = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="user-evaluation/:userId" element={<UserEvaluation />} />
          <Route path="evaluation-management" element={<EvaluationManagement />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
};

export default AppRoutes;