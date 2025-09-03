import React, { useState, useEffect } from 'react'
import { useObservability } from '../contexts/ObservabilityContext'
import { apiBaseUrl } from '../config'

interface ProductSearchProps {
  onTelemetryLog: (log: string) => void
}

interface Product {
  id: string
  name: string
  price: number
  category: string
  inStock: boolean
}

const ProductSearch: React.FC<ProductSearchProps> = ({ onTelemetryLog }) => {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Product[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [searchStats, setSearchStats] = useState({
    totalResults: 0,
    searchTime: 0,
    cacheHit: false
  })

  const performSearch = async (query: string) => {
    if (!query.trim()) {
      setSearchResults([])
      return
    }

    setIsSearching(true)
    
    try {
      // get observability client from context
      const client = useObservability()

      onTelemetryLog(`🔍 Searching for products: "${query}"`)

      // add breadcrumb for search (if client available)
      if (client) {
        client.context.business.addBreadcrumb(
          'Product search initiated',
          { query, query_length: query.length }
        )
      }

      const searchStartTime = performance.now()

      const results = client ? await client.trace('product_search', async (span) => {
        span.setAttributes({
          'search.query': query,
          'search.query_length': query.length,
          'search.type': 'product_catalog'
        })

        // record search metric (if client available)
        if (client) {
          client.metrics.increment('searches_initiated', {
            search_type: 'product',
            query_length_bucket: query.length <= 5 ? 'short' : query.length <= 15 ? 'medium' : 'long'
          })
        }

        // simulate search API call with caching logic
        const response = client ? await client.trace('search_api_call', async (apiSpan) => {
          apiSpan.setAttributes({
            'api.endpoint': '/api/products/search',
            'api.method': 'GET'
          })

          const searchParams = new URLSearchParams({
            q: query,
            include_out_of_stock: 'true'
          })

          const response = await fetch(`${apiBaseUrl}/api/products/search?${searchParams}`)
          
          if (!response.ok) {
            throw new Error(`Search failed: ${response.status}`)
          }

          return response.json()
        }) : await (async () => {
          // fallback API call without tracing
          const searchParams = new URLSearchParams({
            q: query,
            include_out_of_stock: 'true'
          })

          const response = await fetch(`${apiBaseUrl}/api/products/search?${searchParams}`)
          
          if (!response.ok) {
            throw new Error(`Search failed: ${response.status}`)
          }

          return response.json()
        })()

        const searchEndTime = performance.now()
        const searchDuration = searchEndTime - searchStartTime

        // record performance metrics (if client available)
        if (client) {
          client.metrics.histogram('search_duration_ms', searchDuration, {
            search_type: 'product',
            result_count_bucket: response.results.length <= 5 ? 'few' : response.results.length <= 20 ? 'many' : 'lots'
          })

          client.metrics.histogram('search_result_count', response.results.length, {
            search_type: 'product',
            query_length_bucket: query.length <= 5 ? 'short' : 'long'
          })
        }

        // set span attributes based on results
        span.setAttributes({
          'search.results_count': response.results.length,
          'search.duration_ms': searchDuration,
          'search.cache_hit': response.cache_hit || false,
          'search.has_results': response.results.length > 0
        })

        // record cache performance (if client available)
        if (client) {
          if (response.cache_hit) {
            client.metrics.increment('search_cache_hits', {
              search_type: 'product'
            })
            onTelemetryLog('⚡ Search result served from cache')
          } else {
            client.metrics.increment('search_cache_misses', {
              search_type: 'product'
            })
          }
        } else {
          if (response.cache_hit) {
            onTelemetryLog('⚡ Search result served from cache')
          }
        }

        // add breadcrumb for search completion (if client available)
        if (client) {
          client.context.business.addBreadcrumb(
            'Product search completed',
            {
              query,
              results_count: response.results.length,
              duration_ms: Math.round(searchDuration),
              cache_hit: response.cache_hit || false
            }
          )
        }

        onTelemetryLog(`✅ Found ${response.results.length} products in ${Math.round(searchDuration)}ms`)
        onTelemetryLog(`📊 Recorded search performance metrics`)

        setSearchStats({
          totalResults: response.results.length,
          searchTime: Math.round(searchDuration),
          cacheHit: response.cache_hit || false
        })

        return response.results
      }) : await (async () => {
        // fallback search without tracing
        const searchStartTime = performance.now()
        
        const searchParams = new URLSearchParams({
          q: query,
          include_out_of_stock: 'true'
        })

        const response = await fetch(`${apiBaseUrl}/api/products/search?${searchParams}`)
        
        if (!response.ok) {
          throw new Error(`Search failed: ${response.status}`)
        }

        const result = await response.json()
        const searchEndTime = performance.now()
        const searchDuration = searchEndTime - searchStartTime
        
        setSearchStats({
          totalResults: result.results.length,
          searchTime: Math.round(searchDuration),
          cacheHit: result.cache_hit || false
        })

        return result.results
      })()

      setSearchResults(results)
      
    } catch (error) {
      const client = useObservability()

      // capture search error with context (if client available)
      if (client) {
        client.errors.capture(error as Error, {
          tags: {
            component: 'product_search',
            search_query: query
          },
          extra: {
            query,
            queryLength: query.length
          }
        })

        client.context.business.addBreadcrumb(
          'Product search failed',
          {
            query,
            error_message: (error as Error).message
          }
        )
      }

      onTelemetryLog(`❌ Product search failed: ${(error as Error).message}`)
      setSearchResults([])
    } finally {
      setIsSearching(false)
    }
  }

  // debounced search
  useEffect(() => {
    const delayedSearch = setTimeout(() => {
      if (searchQuery.trim()) {
        performSearch(searchQuery)
      }
    }, 300)

    return () => clearTimeout(delayedSearch)
  }, [searchQuery])

  const handleProductClick = async (product: Product) => {
    try {
      const client = useObservability()

      // record product interaction (if client available)
      if (client) {
        client.metrics.increment('product_interactions', {
          product_category: product.category,
          interaction_type: 'view',
          product_availability: product.inStock ? 'in_stock' : 'out_of_stock'
        })

        client.context.business.addBreadcrumb(
          'Product viewed from search results',
          {
            product_id: product.id,
            product_name: product.name,
            product_category: product.category,
            from_search_query: searchQuery
          }
        )
      }

      onTelemetryLog(`👀 Viewed product: ${product.name}`)
    } catch (error) {
      console.error('Failed to track product interaction:', error)
    }
  }

  return (
    <div>
      <h2>🔍 Product Search Demo</h2>
      <p>This scenario demonstrates <strong>performance metrics</strong> with caching patterns and search analytics.</p>

      <div className="card">
        <h3>Product Search</h3>
        <div style={{ marginBottom: '1rem' }}>
          <input
            type="text"
            placeholder="Search for products..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ 
              padding: '0.75rem', 
              fontSize: '1rem',
              width: '100%',
              maxWidth: '400px'
            }}
          />
        </div>

        {searchStats.totalResults > 0 && (
          <div style={{ 
            marginBottom: '1rem', 
            padding: '0.5rem', 
            backgroundColor: '#1a1a1a',
            borderRadius: '4px',
            fontSize: '0.875rem'
          }}>
            Found {searchStats.totalResults} results in {searchStats.searchTime}ms
            {searchStats.cacheHit && <span style={{ color: '#28a745' }}> (cached ⚡)</span>}
          </div>
        )}

        {isSearching && (
          <div style={{ padding: '1rem', fontStyle: 'italic', opacity: 0.7 }}>
            Searching...
          </div>
        )}

        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', 
          gap: '1rem',
          marginTop: '1rem'
        }}>
          {searchResults.map((product) => (
            <div 
              key={product.id}
              onClick={() => handleProductClick(product)}
              style={{
                border: '1px solid #333',
                borderRadius: '8px',
                padding: '1rem',
                backgroundColor: '#1a1a1a',
                cursor: 'pointer',
                transition: 'border-color 0.2s'
              }}
              onMouseEnter={(e) => e.currentTarget.style.borderColor = '#646cff'}
              onMouseLeave={(e) => e.currentTarget.style.borderColor = '#333'}
            >
              <h4 style={{ margin: '0 0 0.5rem 0', color: '#646cff' }}>
                {product.name}
              </h4>
              <p style={{ margin: '0 0 0.5rem 0', fontSize: '1.2rem', fontWeight: 'bold' }}>
                ${product.price}
              </p>
              <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.875rem', opacity: 0.7 }}>
                {product.category}
              </p>
              <p style={{ 
                margin: '0',
                fontSize: '0.875rem',
                color: product.inStock ? '#28a745' : '#dc3545'
              }}>
                {product.inStock ? 'In Stock' : 'Out of Stock'}
              </p>
            </div>
          ))}
        </div>

        {searchQuery && !isSearching && searchResults.length === 0 && (
          <div style={{ padding: '2rem', textAlign: 'center', opacity: 0.5 }}>
            No products found for "{searchQuery}"
          </div>
        )}
      </div>

      <div className="card">
        <h3>🔍 What This Demonstrates</h3>
        <ul style={{ textAlign: 'left' }}>
          <li><strong>Performance Metrics:</strong> Search duration histograms and result count tracking</li>
          <li><strong>Caching Analytics:</strong> Cache hit/miss ratios and performance impact</li>
          <li><strong>Search Behavior:</strong> Query length distribution and result patterns</li>
          <li><strong>Product Interaction:</strong> View tracking with category and availability context</li>
          <li><strong>User Journey:</strong> Search-to-view conversion tracking</li>
        </ul>
      </div>
    </div>
  )
}

export default ProductSearch