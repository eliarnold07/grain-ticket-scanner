import assert from 'node:assert/strict';
import {test} from 'node:test';
import {billingPresentation,billingRestricted,billingError} from '../src/billingPresentation.js';
test('billing presentation distinguishes pending, failed, expired and scheduled cancellation',()=>{
 assert.equal(billingPresentation({status:'past_due',has_access:true}).label,'Payment needs attention');
 assert.equal(billingPresentation({status:'trialing',enforcement_mode:'enforced',has_access:false}).label,'Trial ended');
 assert.equal(billingPresentation({status:'active',has_access:true,enforcement_mode:'enforced',cancel_at_period_end:true}).label,'Cancellation scheduled');
 assert.equal(billingPresentation({status:'incomplete'}).label,'Activation pending');
 assert.equal(billingPresentation({status:'trialing',reason:'verification_required'}).label,'Status check needed');
});
test('client presentation expires stale access and never trusts redirect parameters',()=>{
 assert.equal(billingRestricted({enforcement_mode:'enforced',has_access:false,billing:'returned'}),true);
 assert.equal(billingRestricted({enforcement_mode:'enforced',has_access:true,valid_until:'2000-01-01'}),true);
 assert.equal(billingRestricted({enforcement_mode:'enforced',has_access:true,valid_until:'2099-01-01'}),false);
 assert.match(billingError('USE_BILLING_PORTAL'),/already has a subscription/);
 assert.equal(billingError('secret server diagnostic'),billingError());
});
