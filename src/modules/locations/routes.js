const express = require('express');
const { CITIES, getCity, listWards, source } = require('../../shared/administrativeUnits');

// Public (sign-up needs it): the cities and their wards for the location pickers.
const router = express.Router();

router.get('/cities', (req, res) => {
  res.set('Cache-Control', 'no-cache'); // revalidate (ETag) so renamed wards show up at once
  return res.json({ cities: CITIES.map(({ id, name }) => ({ id, name })), source });
});

router.get('/cities/:cityId/wards', (req, res) => {
  const city = getCity(req.params.cityId);
  if (!city) return res.status(404).json({ message: 'City not found' });
  res.set('Cache-Control', 'no-cache'); // revalidate (ETag) so renamed wards show up at once
  return res.json({
    city: { id: city.id, name: city.name },
    wards: listWards(city.id).map(({ id, name, type, cityId }) => ({ id, name, type, cityId })),
  });
});

module.exports = router;
