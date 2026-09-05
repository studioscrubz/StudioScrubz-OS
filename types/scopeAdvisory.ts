export type ScopeAdvisoryClassification="Clearly Included"|"Possibly Included"|"Not Clearly Included";
export type ScopeAdvisoryMatch={sourceType:"Scope V1"|"Approved Change";sourceId:string;title:string;description?:string;area?:string;matchReason:string};
export type ScopeAdvisoryResult={classification:ScopeAdvisoryClassification;summary:string;matches:ScopeAdvisoryMatch[];advisoryNotice:string};
