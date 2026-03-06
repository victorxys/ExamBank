import { useState, useEffect } from 'react'
import { useAuthStore } from '@/stores/auth-store'

// Simple in-memory cache to avoid redundant requests during a session
const nameCache: Record<string, string> = {}

interface NameResolverProps {
    id?: string
    type: 'customer' | 'employee'
    fallback?: string
}

export function NameResolver({ id, type, fallback = '未知' }: NameResolverProps) {
    const [name, setName] = useState<string>(id ? nameCache[`${type}_${id}`] || '' : '')
    const [loading, setLoading] = useState(!name && !!id)
    const { auth } = useAuthStore()

    useEffect(() => {
        if (!id) {
            setName(fallback)
            setLoading(false)
            return
        }

        const cacheKey = `${type}_${id}`
        if (nameCache[cacheKey]) {
            setName(nameCache[cacheKey])
            setLoading(false)
            return
        }

        const fetchName = async () => {
            setLoading(true)
            try {
                const token = auth.accessToken || localStorage.getItem('access_token')
                const url = type === 'customer'
                    ? `/api/v1/customers/${id}`
                    : `/api/v1/employees/${id}`

                const response = await fetch(url, {
                    headers: { Authorization: `Bearer ${token}` }
                })

                if (response.ok) {
                    const data = await response.json()
                    const resolvedName = data.name || fallback
                    nameCache[cacheKey] = resolvedName
                    setName(resolvedName)
                } else {
                    setName(type === 'employee' ? '未知员工' : fallback)
                }
            } catch (error) {
                console.error(`Error resolving ${type} name:`, error)
                setName(fallback)
            } finally {
                setLoading(false)
            }
        }

        fetchName()
    }, [id, type, fallback, auth.accessToken])

    if (loading) return <span className='text-muted-foreground animate-pulse text-xs'>加载中...</span>
    return <span>{name || fallback}</span>
}
