import { useState } from "react"

interface FormState {
  fullName: string
  username: string
  email: string
  password: string
  confirmPassword: string
  organization: string
  role: string
  acceptTerms: boolean
}

interface FormErrors {
  fullName?: string
  username?: string
  email?: string
  password?: string
  confirmPassword?: string
  acceptTerms?: string
  general?: string
}

const initialState: FormState = {
  fullName: "",
  username: "",
  email: "",
  password: "",
  confirmPassword: "",
  organization: "",
  role: "",
  acceptTerms: false,
}

const usernameRegex = /^[a-zA-Z0-9_-]{3,32}$/
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// min 8, at least 1 upper, 1 lower, 1 digit
const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,32}$/

export default function Register() {
  const [form, setForm] = useState<FormState>(initialState)
  const [errors, setErrors] = useState<FormErrors>({})
  const [submitting, setSubmitting] = useState(false)

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value, type, checked } = e.target
    setForm((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }))
  }

  const validate = (): boolean => {
    const nextErrors: FormErrors = {}

    if (!form.fullName.trim()) {
      nextErrors.fullName = "Full name is required."
    }

    if (!usernameRegex.test(form.username)) {
      nextErrors.username =
        "Username must be 3–32 characters, letters, digits, _ or -."
    }

    if (!emailRegex.test(form.email)) {
      nextErrors.email = "Enter a valid email address."
    }

    if (!passwordRegex.test(form.password)) {
      nextErrors.password =
        "Password must be 8–32 chars, with upper, lower and a digit."
    }

    if (form.confirmPassword !== form.password) {
      nextErrors.confirmPassword = "Passwords must match."
    }

    if (!form.acceptTerms) {
      nextErrors.acceptTerms = "You must accept the terms."
    }

    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return

    try {
      setSubmitting(true)
      setErrors({})
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: form.fullName,
          username: form.username,
          email: form.email,
          password: form.password,
          organization: form.organization,
          role: form.role,
        }),
      })
      if (!res.ok) {
        let msg = 'Registration failed'
        try {
          const data = await res.json()
          if (data?.detail) msg = data.detail
        } catch {
          const text = await res.text()
          if (text) msg = text
        }
        throw new Error(msg)
      }
      window.location.hash = '#/register-success'
    } catch (err: any) {
      setErrors({
        general: err?.message || "Registration failed. Please try again.",
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100%',
        display: 'grid',
        placeItems: 'center',
        backgroundColor: '#f3f4f6',
        padding: '24px',
      }}
    >
      <div
        style={{
          width: '90vw',
          maxWidth: '480px',
          padding: '36px 40px 32px',
          borderRadius: '18px',
          backgroundColor: '#ffffff',
          boxShadow: '0 18px 45px rgba(15, 23, 42, 0.12)',
          margin: '0 auto',
          boxSizing: 'border-box',
        }}
      >
        <h1
          style={{
            fontSize: "24px",
            fontWeight: 700,
            textAlign: "center",
            marginBottom: "6px",
            color: "#111827",
          }}
        >
          BV Orchestrator
        </h1>
        <p
          style={{
            textAlign: "center",
            marginBottom: "24px",
            fontSize: "14px",
            color: "#6b7280",
          }}
        >
          Create your account
        </p>

        {errors.general && (
          <div
            style={{
              marginBottom: "16px",
              fontSize: "14px",
              color: "#b91c1c",
            }}
          >
            {errors.general}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ marginBottom: "16px" }}>
            <label htmlFor="fullName" style={labelStyle}>
              Full name
            </label>
            <input
              id="fullName"
              name="fullName"
              type="text"
              value={form.fullName}
              onChange={handleChange}
              placeholder="Enter full name"
              style={inputStyle}
            />
            {errors.fullName && <FieldError message={errors.fullName} />}
          </div>

          <div style={{ marginBottom: "16px" }}>
            <label htmlFor="username" style={labelStyle}>
              Username
            </label>
            <input
              id="username"
              name="username"
              type="text"
              value={form.username}
              onChange={handleChange}
              placeholder="Choose a username"
              style={{ ...inputStyle }}
            />
            {errors.username && <FieldError message={errors.username} />}
          </div>

          <div style={{ marginBottom: "16px" }}>
            <label htmlFor="email" style={labelStyle}>
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              value={form.email}
              onChange={handleChange}
              placeholder="name@company.com"
              style={{ ...inputStyle }}
            />
            {errors.email && <FieldError message={errors.email} />}
          </div>

          <div style={{ marginBottom: "16px" }}>
            <label htmlFor="password" style={labelStyle}>
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              value={form.password}
              onChange={handleChange}
              placeholder="Create a password"
              style={{ ...inputStyle }}
            />
            {errors.password && <FieldError message={errors.password} />}
          </div>

          <div style={{ marginBottom: "16px" }}>
            <label htmlFor="confirmPassword" style={labelStyle}>
              Confirm password
            </label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              value={form.confirmPassword}
              onChange={handleChange}
              placeholder="Re-enter password"
              style={{ ...inputStyle }}
            />
            {errors.confirmPassword && (
              <FieldError message={errors.confirmPassword} />
            )}
          </div>

          <div style={{ marginBottom: "16px" }}>
            <label htmlFor="organization" style={labelStyle}>
              Organization (optional)
            </label>
            <input
              id="organization"
              name="organization"
              type="text"
              value={form.organization}
              onChange={handleChange}
              placeholder="Your organization"
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: "16px" }}>
            <label htmlFor="role" style={labelStyle}>
              Role (optional)
            </label>
            <select
              id="role"
              name="role"
              value={form.role}
              onChange={handleChange}
              style={{ ...inputStyle, paddingRight: "32px" }}
            >
              <option value="">Select role</option>
              <option value="Developer">Developer</option>
              <option value="Architect">Architect</option>
              <option value="Admin">Admin</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <div style={{ marginBottom: "20px", fontSize: "14px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                name="acceptTerms"
                checked={form.acceptTerms}
                onChange={handleChange}
              />
              <span>I accept the Terms of Service and Privacy Policy.</span>
            </label>
            {errors.acceptTerms && <FieldError message={errors.acceptTerms} />}
          </div>

          <button
            type="submit"
            disabled={submitting}
            style={{
              width: "100%",
              padding: "12px",
              borderRadius: "8px",
              border: "none",
              fontSize: "16px",
              fontWeight: 600,
              backgroundColor: submitting ? "#93c5fd" : "#2563eb",
              color: "#ffffff",
              cursor: submitting ? "default" : "pointer",
            }}
          >
            {submitting ? "Registering..." : "Register"}
          </button>
          <div
            style={{
              marginTop: 16,
              textAlign: 'center',
              fontSize: '14px',
              color: '#6b7280',
            }}
          >
            Already registered?{' '}
            <a
              href="#/"
              style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 600 }}
            >
              Log in
            </a>
          </div>
        </form>
      </div>
    </div>
  )
}

// shared styles
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: "8px",
  border: "1px solid #e5e7eb",
  fontSize: "14px",
  outline: "none",
  boxSizing: "border-box",
}

const labelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: "6px",
  fontSize: "14px",
  fontWeight: 600,
  color: "#111827",
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <div style={{ marginTop: "4px", fontSize: "12px", color: "#b91c1c" }}>
      {message}
    </div>
  )
}
