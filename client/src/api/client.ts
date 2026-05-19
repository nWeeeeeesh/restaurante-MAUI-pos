import axios from 'axios'

// Timeout de 15s para detectar redes lentas o servidor caído antes de que el
// usuario espere indefinidamente. Endpoints de impresión y reportes pesados
// pueden override con `{ timeout: 30000 }` en la llamada si lo necesitan.
const api = axios.create({ baseURL: '/api', timeout: 15000 })

api.interceptors.request.use(config => {
  const token = localStorage.getItem('mauideskToken')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('mauideskToken')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export default api
