import express from 'express'

const router = express.Router()

// PUT /api/profile - Profile update with context enrichment
router.put('/', async (req, res) => {
  const client = req.observabilityClient
  const { name, email, phone, preferences } = req.body
  let profileId: string | null = null

  try {
    if (client) {
      // get scoped instrumentation for profile module
      const profileService = client.getInstrumentation('web-store/profile', '1.0.0');

      // note: context.run() is now handled by middleware in server.ts
      profileId = await profileService.trace('update_profile', async (span) => {
          span.setAttributes({
            'profile.user_id': 'user-123',
            'profile.fields_updated': Object.keys(req.body).length,
            'profile.email_changed': email !== 'demo@example.com',
            'profile.phone_provided': !!phone,
            'service.name': 'web-store-backend'
          })

          // add breadcrumb for profile update start
          client.context.business.addBreadcrumb('Backend profile update initiated', {
            category: 'profile_management',
            level: 'info',
            fields_updated: Object.keys(req.body),
            email_changed: email !== 'demo@example.com'
          })

          // simulate validation
          await profileService.trace('validate_profile_data', async (validationSpan) => {
            validationSpan.setAttributes({
              'validation.email_format_valid': /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
              'validation.phone_format_valid': !phone || /^\+?[\d\s-()]+$/.test(phone),
              'validation.name_length_valid': name && name.length >= 2
            })

            await new Promise(resolve => setTimeout(resolve, 100))

            // basic validation
            if (!name || name.length < 2) {
              throw new Error('Name must be at least 2 characters')
            }
            
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
              throw new Error('Invalid email format')
            }

            client.context.business.addBreadcrumb('Profile validation completed', {
              category: 'validation',
              level: 'info'
            })
          })

          // simulate user context enrichment
          await profileService.trace('enrich_user_context', async (enrichSpan) => {
            enrichSpan.setAttributes({
              'context.previous_email': 'demo@example.com',
              'context.new_email': email,
              'context.preferences_updated': !!preferences
            })

            // update user context with new profile data
            client.context.business.setUser({
              id: 'user-123',
              email,
              name,
              phone
            })

            await new Promise(resolve => setTimeout(resolve, 50))

            client.context.business.addBreadcrumb('User context enriched with new profile data', {
              category: 'context_enrichment',
              level: 'info'
            })
          })

          // simulate profile persistence
          return await profileService.trace('save_profile', async (saveSpan) => {
            const newProfileId = `profile-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
            
            saveSpan.setAttributes({
              'db.operation': 'update',
              'db.table': 'user_profiles',
              'profile.id': newProfileId
            })

            await new Promise(resolve => setTimeout(resolve, 150))

            // record business metrics with low-cardinality attributes
            // note: user_id is stored in span attributes and context, not metric labels
            profileService.metrics.increment('profiles_updated', {
              fields_count: Object.keys(req.body).length <= 2 ? 'few' : 'many',
              source: 'api'
            })

            // track specific field updates with low-cardinality labels
            if (email !== 'demo@example.com') {
              profileService.metrics.increment('profile_email_changes', {
                source: 'api'
              })
            }

            if (preferences) {
              profileService.metrics.increment('profile_preferences_updates', {
                notifications_enabled: preferences.notifications ? 'true' : 'false',
                source: 'api'
              })
            }

            client.context.business.addBreadcrumb('Profile saved to database', {
              category: 'database',
              level: 'info',
              profileId: newProfileId,
              fields_updated: Object.keys(req.body).length
            })

            return newProfileId
          })
        })
    } else {
      // simulate processing without observability if client not available
      await new Promise(resolve => setTimeout(resolve, 300)) // simulate total processing time
      
      // basic validation
      if (!name || name.length < 2) {
        throw new Error('Name must be at least 2 characters')
      }
      
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error('Invalid email format')
      }
      
      profileId = `profile-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    }
    
    res.json({
      success: true,
      profileId,
      message: 'Profile updated successfully',
      updatedFields: Object.keys(req.body),
      profile: {
        name,
        email,
        phone,
        preferences,
        lastUpdated: new Date().toISOString()
      }
    })

  } catch (error) {
    if (client) {
      client.errors.record(error as Error, {
        tags: {
          component: 'profile_management',
          user_id: 'user-123'
        },
        extra: {
          profileData: req.body,
          userAction: 'profile_update'
        }
      })

      client.context.business.addBreadcrumb('Profile update failed', {
        category: 'error',
        level: 'error',
        error_message: (error as Error).message,
        fields_attempted: Object.keys(req.body)
      })

      const profileService = client.getInstrumentation('web-store/profile', '1.0.0');
      profileService.metrics.increment('profile_update_failures', {
        error_type: (error as Error).message.includes('email') ? 'validation' :
                   (error as Error).message.includes('Name') ? 'validation' : 'unknown',
        source: 'api'
      })
    }

    console.error('Profile update failed:', error)
    res.status(400).json({
      success: false,
      error: (error as Error).message,
      profileId: null
    })
  }
})

export { router as profileRouter }