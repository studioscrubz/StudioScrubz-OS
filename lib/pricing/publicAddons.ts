import type { CatalogAddonSnapshot, ServiceAddon } from "@/types/serviceCatalog";

export function publicAddonSelections(names:string[], quantities:Record<string,number>|undefined, availableAddons:ServiceAddon[]):CatalogAddonSnapshot[] {
  return names.map(name=>{
    const addon=availableAddons.find(item=>item.addon_name===name);
    if(!addon)throw new Error(`Pricing is unavailable for add-on: ${name}`);
    const pricingType=addon.pricing_config.pricing_type==="Per Unit"?"Per Unit":"Flat Price";
    const rawUnitPrice=addon.pricing_config.unit_price??addon.price;
    const unitPrice=Number(rawUnitPrice);
    if(rawUnitPrice==null||!Number.isFinite(unitPrice)||unitPrice<0)throw new Error(`Pricing is unavailable for add-on: ${name}`);
    const quantity=pricingType==="Per Unit"?Number(quantities?.[name]??1):1;
    if(!Number.isInteger(quantity)||quantity<1)throw new Error(`Enter a whole-number quantity of at least 1 for ${name}.`);
    const unitName=String(addon.pricing_config.unit_name??addon.unit_label??"").trim()||null;
    if(pricingType==="Per Unit"&&!unitName)throw new Error(`Pricing is unavailable for add-on: ${name}`);
    return{id:addon.id,catalogAddonId:addon.id,name:addon.addon_name,description:addon.description,price:unitPrice,pricingModel:addon.pricing_model,unitLabel:addon.unit_label,pricingType,quantity,unitName,unitPrice,lineTotal:Math.round(quantity*unitPrice*100)/100};
  });
}
