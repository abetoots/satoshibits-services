import express from 'express'

const router = express.Router()

// Mock product data
const products = [
  { id: 'prod-1', name: 'Laptop Pro', price: 1299.99, category: 'electronics', inStock: true },
  { id: 'prod-2', name: 'Wireless Headphones', price: 199.99, category: 'electronics', inStock: true },
  { id: 'prod-3', name: 'Coffee Maker', price: 89.99, category: 'appliances', inStock: false },
  { id: 'prod-4', name: 'Running Shoes', price: 129.99, category: 'sports', inStock: true },
  { id: 'prod-5', name: 'Desk Chair', price: 299.99, category: 'furniture', inStock: true },
  { id: 'prod-6', name: 'Smartphone', price: 699.99, category: 'electronics', inStock: true },
  { id: 'prod-7', name: 'Yoga Mat', price: 29.99, category: 'sports', inStock: true },
  { id: 'prod-8', name: 'Blender', price: 149.99, category: 'appliances', inStock: true },
  { id: 'prod-9', name: 'Gaming Mouse', price: 79.99, category: 'electronics', inStock: false },
  { id: 'prod-10', name: 'Book Shelf', price: 199.99, category: 'furniture', inStock: true },
]

// Simple in-memory cache simulation
const searchCache = new Map<string, { results: any[], timestamp: number, hit: boolean }>()
const CACHE_TTL = 30000 // 30 seconds

// GET /api/products/search - Product search with performance metrics
router.get('/search', async (req, res) => {
  const client = req.observabilityClient
  const query = req.query.q as string
  const includeOutOfStock = req.query.include_out_of_stock === 'true'
  let results: any[] = []
  let cacheHit = false
  let searchDuration = 0

  try {
    if (!query || query.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Search query is required',
        results: []
      })
    }

    if (client) {
      // run in business context for search
      const searchResult = await client.context.run({
        tenantId: 'demo-tenant',
        requestId: `search-${Date.now()}`,
        feature: 'product_search',
        searchQuery: query
      }, async () => {

        return await client.trace('product_search', async (span) => {
          const searchStartTime = Date.now()
          
          span.setAttributes({
            'search.query': query,
            'search.query_length': query.length,
            'search.type': 'product_catalog',
            'search.include_out_of_stock': includeOutOfStock,
            'service.name': 'web-store-backend'
          })

          // add breadcrumb for search start
          client.context.business.addBreadcrumb('Backend product search initiated', {
            category: 'product_search',
            level: 'info',
            query,
            query_length: query.length,
            include_out_of_stock: includeOutOfStock
          })

          // record search initiation metric
          client.metrics.increment('product_searches_initiated', {
            search_type: 'catalog',
            query_length_bucket: query.length <= 5 ? 'short' : query.length <= 15 ? 'medium' : 'long',
            include_out_of_stock: includeOutOfStock.toString()
          })

          // check cache first
          
          await client.trace('search_cache_lookup', async (cacheSpan) => {
            const cacheKey = `${query.toLowerCase()}-${includeOutOfStock}`
            const cached = searchCache.get(cacheKey)
            
            cacheSpan.setAttributes({
              'cache.key': cacheKey,
              'cache.lookup_time_ms': 1
            })

            if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
              results = cached.results
              cacheHit = true
              
              cacheSpan.setAttributes({
                'cache.hit': true,
                'cache.results_count': results.length
              })

              client.context.business.addBreadcrumb('Search result served from cache', {
                category: 'cache',
                level: 'info',
                cache_key: cacheKey,
                results_count: results.length
              })

              client.metrics.increment('product_search_cache_hits', {
                search_type: 'catalog'
              })
            } else {
              cacheSpan.setAttributes({
                'cache.hit': false,
                'cache.expired': cached ? (Date.now() - cached.timestamp) > CACHE_TTL : false
              })

              client.metrics.increment('product_search_cache_misses', {
                search_type: 'catalog'
              })
            }
          })

          // perform actual search if not cached
          if (!cacheHit) {
            results = await client.trace('search_execution', async (searchSpan) => {
              // simulate database search
              await new Promise(resolve => setTimeout(resolve, 150))
              
              const queryLower = query.toLowerCase()
              let filteredProducts = products.filter(product => 
                product.name.toLowerCase().includes(queryLower) ||
                product.category.toLowerCase().includes(queryLower)
              )

              if (!includeOutOfStock) {
                filteredProducts = filteredProducts.filter(p => p.inStock)
              }

              searchSpan.setAttributes({
                'search.database_query_duration_ms': 150,
                'search.total_products_scanned': products.length,
                'search.results_found': filteredProducts.length,
                'search.filter_applied': !includeOutOfStock ? 'in_stock_only' : 'all'
              })

              // update cache
              const cacheKey = `${query.toLowerCase()}-${includeOutOfStock}`
              searchCache.set(cacheKey, {
                results: filteredProducts,
                timestamp: Date.now(),
                hit: false
              })

              client.context.business.addBreadcrumb('Database search completed and cached', {
                category: 'search_execution',
                level: 'info',
                results_found: filteredProducts.length,
                cache_key: cacheKey
              })

              return filteredProducts
            })
          }

          const searchDuration = Date.now() - searchStartTime

          // record performance metrics
          client.metrics.histogram('product_search_duration_ms', searchDuration, {
            search_type: 'catalog',
            cache_hit: cacheHit.toString(),
            result_count_bucket: results.length <= 5 ? 'few' : results.length <= 20 ? 'many' : 'lots'
          })

          client.metrics.histogram('product_search_result_count', results.length, {
            search_type: 'catalog',
            query_length_bucket: query.length <= 5 ? 'short' : 'long',
            cache_hit: cacheHit.toString()
          })

          // update span with final results
          span.setAttributes({
            'search.results_count': results.length,
            'search.duration_ms': searchDuration,
            'search.cache_hit': cacheHit,
            'search.has_results': results.length > 0
          })

          client.context.business.addBreadcrumb('Product search completed', {
            category: 'search_completion',
            level: 'info',
            query,
            results_count: results.length,
            duration_ms: searchDuration,
            cache_hit: cacheHit
          })

          return { results: results, cacheHit, searchDuration }
        })
      })
      
      // assign results from instrumented block
      if (searchResult) {
        results = searchResult.results
        cacheHit = searchResult.cacheHit
        searchDuration = searchResult.searchDuration
      }
    }
    
    if (!client) {
      const searchStartTime = Date.now()
      
      // check cache
      const cacheKey = `${query.toLowerCase()}-${includeOutOfStock}`
      const cached = searchCache.get(cacheKey)
      
      if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
        results = cached.results
        cacheHit = true
      } else {
        // simulate database search
        await new Promise(resolve => setTimeout(resolve, 150))
        
        const queryLower = query.toLowerCase()
        let filteredProducts = products.filter(product => 
          product.name.toLowerCase().includes(queryLower) ||
          product.category.toLowerCase().includes(queryLower)
        )

        if (!includeOutOfStock) {
          filteredProducts = filteredProducts.filter(p => p.inStock)
        }

        results = filteredProducts
        
        // update cache
        searchCache.set(cacheKey, {
          results,
          timestamp: Date.now(),
          hit: false
        })
      }
      
      searchDuration = Date.now() - searchStartTime
    }

    res.json({
      success: true,
      results,
      cache_hit: cacheHit,
      metadata: {
        query,
        total_results: results.length,
        search_duration_ms: searchDuration,
        include_out_of_stock: includeOutOfStock,
        timestamp: new Date().toISOString()
      }
    })

  } catch (error) {
    if (client) {
      client.errors.capture(error as Error, {
        tags: {
          component: 'product_search',
          search_query: query
        },
        extra: {
          query,
          queryLength: query?.length || 0,
          includeOutOfStock
        }
      })

      client.context.business.addBreadcrumb('Product search failed', {
        category: 'error',
        level: 'error',
        query,
        error_message: (error as Error).message
      })

      client.metrics.increment('product_search_failures', {
        search_type: 'catalog',
        error_type: 'search_error'
      })
    }

    console.error('Product search failed:', error)
    res.status(500).json({
      success: false,
      error: (error as Error).message,
      results: []
    })
  }
})

export { router as productsRouter }