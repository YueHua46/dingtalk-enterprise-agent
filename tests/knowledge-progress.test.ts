import {expect,it} from 'vitest';
import {ingestionHasGaps} from '../scripts/knowledge-progress.mjs';

it('does not declare full ingestion complete when zero-text resources need review or work remains',()=>{
 const complete={total:10,processed:10,passed:8,skipped:2,failed:0,needsReview:0};
 expect(ingestionHasGaps({text:complete,images:complete})).toBe(false);
 expect(ingestionHasGaps({text:complete,images:{...complete,passed:7,needsReview:1}})).toBe(true);
 expect(ingestionHasGaps({text:complete,images:{...complete,processed:9}})).toBe(true);
 expect(ingestionHasGaps({text:{...complete,passed:7,failed:1},images:complete})).toBe(true);
});
