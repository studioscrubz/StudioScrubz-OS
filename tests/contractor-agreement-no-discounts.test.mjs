import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
function load(path,imports={}){const module={exports:{}};const js=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('exports','module','require',js)(module.exports,module,name=>{if(!(name in imports))throw Error(name);return imports[name]});return module.exports;}
const frequency=load('lib/scheduling/frequency.ts');
const engine=load('lib/pricing/pricingEngine.ts',{'@/lib/scheduling/frequency':frequency});
const pricing=load('lib/pricing/agreementPricing.ts',{'@/lib/pricing/pricingEngine':engine});
const input={standardPrice:125,frequency:'Weekly',serviceId:'retail',customDiscount:5,rules:[{id:'weekly',rule_name:'Weekly',frequency:'Weekly',adjustment_type:'Percentage',adjustment_value:10,service_id:null,is_active:true}]};
test('contractor retains negotiated per visit rate with no recurring or manual discount',()=>{
 const result=pricing.catalogAgreementPricing({...input,isContractor:true});
 assert.equal(result.final_per_visit_price,125);assert.equal(result.frequency_discount_amount,0);assert.equal(result.custom_discount_amount,0);assert.equal(result.recurring_pricing_rule_id,null);
});
test('ordinary customer recurring and manual discounts remain available',()=>{
 const result=pricing.catalogAgreementPricing(input);assert.equal(result.frequency_discount_amount,12.5);assert.equal(result.custom_discount_amount,5);assert.equal(result.final_per_visit_price,107.5);
});
