export interface CostExtension {
  requestedQueryCost: number;
  actualQueryCost?: number;
  throttleStatus: CostExtensionThrottle;
}

export interface CostExtensionThrottle {
  maximumAvailable: number;
  currentlyAvailable: number;
  restoreRate: number;
}

export type ImageNode = {
  id: string;
  height: number;
  width: number;
  url: string;
}

export type Edge = {
  node: {
    images: {
      nodes: ImageNode[]
    }
  }
}

export type ShopifyProductsBody = {
  data: {
    products: {
      edges: Edge[]
    }
  },
  extensions: {
    cost: CostExtension
  }
}

export type ShopifyProductBody = {
  data: {
    product: {
      featuredImage: {
        id: string
      }
    }
  },
  extensions: {
    cost: CostExtension
  }
}

export type ProductType = {
  model_number: string,
  product_id: string
}

export type PriceQtyCronJobSourceType = {
  kc_sku: string;
  price: string;
  qty: string;
}