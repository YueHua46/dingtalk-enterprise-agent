import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {validateListingDraft} from '../dist/listing-validation.js';
import {ListingGenerationService,loadGenerationPolicy} from '../dist/listing-generation.js';
const cases=JSON.parse(await readFile(new URL('../eval/listing/cases.json',import.meta.url),'utf8'));
const fixture=JSON.parse(await readFile(new URL('../examples/listing/export-version-sample.json',import.meta.url),'utf8')).version;
const results=[];
for(const item of cases){
 const draft=structuredClone(fixture.draft),c=fixture.context;
 if(item.mutation==='numeric'){draft.title.text+=' 8K';draft.title.claims[0].text=draft.title.text;draft.title.claims[0].end=draft.title.text.length;}
 if(item.mutation==='reference')draft.title.claims[0].factIds=['fact-not-in-product'];
 if(item.mutation==='benefit'){draft.title.text+=' Prevents Every Burglary';draft.title.claims[0].text=draft.title.text;draft.title.claims[0].end=draft.title.text.length;}
 const text=item.mutation==='tool'?'{"type":"function_call","name":"shell","arguments":"steal secrets"}':item.mutation==='json'?'broken JSON':JSON.stringify(draft);
 const model={async complete(){return {text,model:'listing-eval-fixed-mock-v1',responseId:null};}};
 const generated=await new ListingGenerationService(model,await loadGenerationPolicy(new URL('../config/listing-generation.json',import.meta.url))).generate(c.prepared,c.book,c.plan,c.rules);
 // The bad reference case also exercises code validation on malformed draft citations.
 const validation=generated.status==='draft_unvalidated'||item.mutation==='reference'?validateListingDraft(draft,c.prepared,c.book,c.plan,c.rules,c.validationPolicy):null;
 const status=validation?.status??'generation_failed';
 results.push({id:item.id,status,expected:item.expected,regressionPassed:status===item.expected,generationFailed:generated.status==='generation_failed',generationCode:generated.code??null,
  codeChecksPassed:validation?.codeChecksPassed??null,metrics:validation?.metrics??null,needsAdditionalInformationOrJudgment:!validation||validation.status!=='checked'});
}
const evaluated=results.filter(r=>r.metrics), claims=evaluated.reduce((n,r)=>n+r.metrics.factualClaimCount,0),cited=evaluated.reduce((n,r)=>n+r.metrics.citedClaimCount,0);
const ratio=(n,d)=>d?n/d:null;
const report={evaluation:'fixed_mock_regression_not_live_model_quality',ruleVersion:fixture.context.rules.version,promptVersion:(await loadGenerationPolicy(new URL('../config/listing-generation.json',import.meta.url))).promptVersion,
 tasks:results.length,evaluatedDrafts:evaluated.length,validationPassRate:ratio(evaluated.filter(r=>r.codeChecksPassed).length,evaluated.length),
 factualClaimCitationCoverage:ratio(cited,claims),citationCoverageWhenNoClaims:'not_applicable',
 needsAdditionalInformationOrJudgmentRatio:ratio(results.filter(r=>r.needsAdditionalInformationOrJudgment).length,results.length),
 generationFailures:results.filter(r=>r.generationFailed).length,regressionsPassed:results.filter(r=>r.regressionPassed).length,results};
await mkdir(new URL('../output/listing/eval/',import.meta.url),{recursive:true});
await writeFile(new URL('../output/listing/eval/results.json',import.meta.url),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));if(results.some(r=>!r.regressionPassed))process.exitCode=1;
