const express = require('express');
const router = express.Router();
const { catchAsync } = require('../utils/error-handler');

router.get('/simulation', catchAsync(async (req, res) => {
  const currentYear = new Date().getFullYear();
  const selectedYear = req.query.year ? parseInt(req.query.year, 10) : currentYear;

  res.render('simulation', {
    user: req.session.user,
    isAdmin: req.session.isAdmin,
    selectedYear,
    currentYear
  });
}));

router.get('/elo', catchAsync(async (req, res) => {
  res.render('elo', {
    user: req.session.user,
    isAdmin: req.session.isAdmin
  });
}));

module.exports = router;
