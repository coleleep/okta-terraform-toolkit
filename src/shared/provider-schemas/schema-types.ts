export interface AttributeSchema {
  type: string | unknown[];
  description?: string;
  required?: boolean;
  optional?: boolean;
  computed?: boolean;
  deprecated?: boolean;
}

export interface BlockTypeSchema {
  nesting_mode: 'single' | 'list' | 'set' | 'map';
  min_items?: number;
  max_items?: number;
  attributes?: Record<string, AttributeSchema>;
  block_types?: Record<string, BlockTypeSchema>;
}

export interface ResourceSchema {
  attributes?: Record<string, AttributeSchema>;
  block_types?: Record<string, BlockTypeSchema>;
}

export interface ProviderSchema {
  resource_schemas: Record<string, ResourceSchema>;
  data_source_schemas: Record<string, ResourceSchema>;
}
