import React, { useState } from 'react'
import { useObservability } from '../contexts/ObservabilityContext'
import { apiBaseUrl } from '../config'

interface ProfileUpdateProps {
  onTelemetryLog: (log: string) => void
}

const ProfileUpdate: React.FC<ProfileUpdateProps> = ({ onTelemetryLog }) => {
  const [profileData, setProfileData] = useState({
    name: 'Demo User',
    email: 'demo@example.com',
    phone: '+1-555-0123',
    preferences: {
      notifications: true,
      newsletter: false
    }
  })
  const [isUpdating, setIsUpdating] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const updateProfile = async () => {
    setIsUpdating(true)
    setResult(null)
    
    try {
      // get observability client from context
      const client = useObservability()

      onTelemetryLog('👤 Starting profile update flow...')

      // add breadcrumb sequence showing user journey (if client available)
      if (client) {
        client.context.business.addBreadcrumb('User navigated to profile page', {
          category: 'navigation',
          level: 'info'
        })

        client.context.business.addBreadcrumb('Profile form validation started', {
          category: 'user_action',
          level: 'info',
          fields_modified: ['name', 'email', 'phone']
        })
      }

      // simulate form validation steps (with fallback)
      if (client) {
        await client.trace('validate_profile_form', async (span) => {
        span.setAttributes({
          'profile.email_changed': profileData.email !== 'demo@example.com',
          'profile.phone_provided': !!profileData.phone,
          'profile.notifications_enabled': profileData.preferences.notifications
        })

          // simulate validation delay
          await new Promise(resolve => setTimeout(resolve, 200))
          
          client.context.business.addBreadcrumb('Profile form validation completed', {
            category: 'validation',
            level: 'info'
          })

          onTelemetryLog('✅ Profile form validation passed')
        })
      } else {
        // fallback validation without tracing
        await new Promise(resolve => setTimeout(resolve, 200))
        onTelemetryLog('✅ Profile form validation passed')
      }

      // update user context with new information (if client available)
      if (client) {
        client.context.business.setUser({
          id: 'user-123',
          email: profileData.email,
          name: profileData.name,
          phone: profileData.phone
        })

        client.context.business.addBreadcrumb('User context updated with new profile data', {
          category: 'context_enrichment',
          level: 'info'
        })
      }

      // simulate API call to backend (with fallback)
      const result = client ? await client.trace('update_profile_api', async (span) => {
        span.setAttributes({
          'api.endpoint': '/api/profile',
          'api.method': 'PUT',
          'profile.fields_updated': Object.keys(profileData).length
        })

        const response = await fetch(`${apiBaseUrl}/api/profile`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(profileData)
        })

        if (!response.ok) {
          throw new Error(`Profile update failed: ${response.status}`)
        }

        const updateResult = await response.json()
        
        // record metric for profile updates
        if (client) {
          client.metrics.increment('profile_updates', {
            user_id: 'user-123',
            fields_updated: Object.keys(profileData).length.toString()
          })
        }

        onTelemetryLog('✅ Profile updated successfully with enriched context')
        onTelemetryLog('📊 Recorded profile update metric')

        return updateResult
      }) : await (async () => {
        // fallback API call without tracing
        const response = await fetch(`${apiBaseUrl}/api/profile`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(profileData)
        })

        if (!response.ok) {
          throw new Error(`Profile update failed: ${response.status}`)
        }

        return response.json()
      })()

      // final breadcrumb (if client available)
      if (client) {
        client.context.business.addBreadcrumb('Profile update completed successfully', {
          category: 'user_action',
          level: 'info',
          profile_id: result.profileId
        })
      }

      setResult('Profile updated successfully! Context enriched with new user data.')
      
    } catch (error) {
      const client = useObservability()

      // capture error with enriched context (if client available)
      if (client) {
        client.errors.capture(error as Error, {
          tags: {
            component: 'profile_update',
            user_id: 'user-123'
          },
          extra: {
            profileData,
            userAction: 'profile_update'
          }
        })

        client.context.business.addBreadcrumb('Profile update failed', {
          category: 'error',
          level: 'error',
          error_message: (error as Error).message
        })
      }

      onTelemetryLog(`❌ Profile update failed: ${(error as Error).message}`)
      setResult(`Error: ${(error as Error).message}`)
    } finally {
      setIsUpdating(false)
    }
  }

  return (
    <div>
      <h2>👤 Profile Update Demo</h2>
      <p>This scenario demonstrates <strong>business context enrichment</strong> and <strong>breadcrumb accumulation</strong> across user interactions.</p>

      <div className="card">
        <h3>Profile Information</h3>
        <div style={{ marginBottom: '1rem' }}>
          <label>Name: </label>
          <input
            type="text"
            value={profileData.name}
            onChange={(e) => setProfileData({...profileData, name: e.target.value})}
            style={{ marginLeft: '1rem', padding: '0.5rem', width: '200px' }}
          />
        </div>
        <div style={{ marginBottom: '1rem' }}>
          <label>Email: </label>
          <input
            type="email"
            value={profileData.email}
            onChange={(e) => setProfileData({...profileData, email: e.target.value})}
            style={{ marginLeft: '1rem', padding: '0.5rem', width: '200px' }}
          />
        </div>
        <div style={{ marginBottom: '1rem' }}>
          <label>Phone: </label>
          <input
            type="tel"
            value={profileData.phone}
            onChange={(e) => setProfileData({...profileData, phone: e.target.value})}
            style={{ marginLeft: '1rem', padding: '0.5rem', width: '200px' }}
          />
        </div>
        
        <div style={{ marginBottom: '1rem' }}>
          <label>
            <input
              type="checkbox"
              checked={profileData.preferences.notifications}
              onChange={(e) => setProfileData({
                ...profileData,
                preferences: {...profileData.preferences, notifications: e.target.checked}
              })}
              style={{ marginRight: '0.5rem' }}
            />
            Enable notifications
          </label>
        </div>
        
        <div style={{ marginBottom: '1rem' }}>
          <label>
            <input
              type="checkbox"
              checked={profileData.preferences.newsletter}
              onChange={(e) => setProfileData({
                ...profileData,
                preferences: {...profileData.preferences, newsletter: e.target.checked}
              })}
              style={{ marginRight: '0.5rem' }}
            />
            Subscribe to newsletter
          </label>
        </div>

        <button 
          onClick={updateProfile} 
          disabled={isUpdating}
          style={{ 
            padding: '1rem 2rem', 
            fontSize: '1.1rem',
            backgroundColor: isUpdating ? '#666' : '#646cff'
          }}
        >
          {isUpdating ? 'Updating Profile...' : 'Update Profile'}
        </button>

        {result && (
          <div style={{ 
            marginTop: '1rem', 
            padding: '1rem', 
            backgroundColor: result.includes('Error') ? '#dc3545' : '#28a745',
            borderRadius: '4px'
          }}>
            {result}
          </div>
        )}
      </div>

      <div className="card">
        <h3>🔍 What This Demonstrates</h3>
        <ul style={{ textAlign: 'left' }}>
          <li><strong>Breadcrumb Sequence:</strong> Navigation → validation → API call → completion</li>
          <li><strong>Context Enrichment:</strong> User context updated with new profile data</li>
          <li><strong>Session Context:</strong> Breadcrumbs accumulated across user journey</li>
          <li><strong>Business Metrics:</strong> Profile update counters with field tracking</li>
          <li><strong>Error Context:</strong> Failed updates correlated with user actions</li>
        </ul>
      </div>
    </div>
  )
}

export default ProfileUpdate