import {describe,it,expect} from 'vitest';
import {locateListingClaims} from '../src/listing-generation.js';
const draft=(value: string,phrase: string)=>{
  const field={text:value,claims:[{text:phrase,factIds:['fact-own']}]};
  return {title:field,bullets:[field],description:field,searchTerms:{text:'',keywordRefs:[],factIds:[]},changes:[],verificationItems:[]};
};
describe('model literal claim locations',()=>{
  it('assembles cited segments with deterministic offsets, including repeated text',()=>{
    const field={segments:[{text:'📷 Camera',factIds:['a']},{text:'Camera',factIds:['b']}]};
    const value={title:field,bullets:[field],description:field,searchTerms:{text:'',keywordRefs:[],factIds:[]},changes:[],verificationItems:[]};
    const result=locateListingClaims(value) as any;
    expect(result.title.text).toBe('📷 Camera Camera');
    expect(result.title.claims).toEqual([{text:'📷 Camera',factIds:['a'],start:0,end:9},{text:'Camera',factIds:['b'],start:10,end:16}]);
  });
  it('locates unique literal text using UTF-16 offsets without editing copy or facts',()=>{
    const result=locateListingClaims(draft('📷 Indoor Camera','Indoor Camera')) as any;
    expect(result.title.claims[0]).toEqual({text:'Indoor Camera',factIds:['fact-own'],start:3,end:16});
    expect(result.title.text).toBe('📷 Indoor Camera');
  });
  it('rejects absent and ambiguous spans instead of choosing a location',()=>{
    expect(()=>locateListingClaims(draft('Indoor Camera','Outdoor Camera'))).toThrow('AMBIGUOUS_CLAIM_SPAN');
    expect(()=>locateListingClaims(draft('Camera Camera','Camera'))).toThrow('AMBIGUOUS_CLAIM_SPAN');
  });
});
