const inventoryService = require('./inventoryService');
const seoService = require('./seoService');

function resolvePrimaryImage(unit) {
  if (unit.media?.photos?.length) {
    const hero = unit.media.photos.find(photo => photo.isHero) || unit.media.photos[0];
    return hero?.optimizedUrl || hero?.url;
  }
  if (Array.isArray(unit.images) && unit.images.length) {
    return unit.images[0];
  }
  return undefined;
}

function cleanObject(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined && value !== null));
}

function buildJsonLd(unit, tenantId) {
  const profile = seoService.ensureInventoryProfile(unit, tenantId);
  const image = resolvePrimaryImage(unit);
  const totalPrice = unit.totalPrice || Number(unit.salePrice ?? unit.price ?? 0) || undefined;
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'RecreationalVehicle',
    name: profile?.metaTitle || unit.name,
    description: profile?.metaDescription || unit.description || unit.salesStory,
    brand: unit.brand || unit.manufacturer,
    model: unit.name,
    image,
    url: unit.slug ? `/inventory/${unit.slug}` : `/inventory/${unit.id}`,
    price: totalPrice,
    priceCurrency: unit.currency || 'USD',
    fuelType: unit.fuelType,
    mileageFromOdometer: unit.mileage
      ? {
          '@type': 'QuantitativeValue',
          value: Number(unit.mileage),
          unitCode: 'SMI'
        }
      : undefined,
    vehicleConfiguration: unit.subcategory || unit.category,
    numberOfBeds: unit.beds ? Number(unit.beds) : undefined,
    availability:
      unit.transferStatus === 'sold'
        ? 'https://schema.org/SoldOut'
        : 'https://schema.org/InStock',
    itemCondition:
      unit.condition === 'new'
        ? 'https://schema.org/NewCondition'
        : unit.condition
          ? 'https://schema.org/UsedCondition'
          : undefined
  };

  return cleanObject(schema);
}

function getSchemaForInventory(id, tenantId) {
  const unit = inventoryService.findById(id, tenantId);
  if (!unit) return { notFound: true };
  return { schema: buildJsonLd(unit, tenantId) };
}

module.exports = {
  getSchemaForInventory,
  buildJsonLd
};
