export default function RegisterSuccess() {
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
          width: '100%',
          maxWidth: '480px',
          padding: '36px 40px 32px',
          borderRadius: '18px',
          backgroundColor: '#ffffff',
          boxShadow: '0 18px 45px rgba(15, 23, 42, 0.12)',
          textAlign: 'center',
          margin: '0 auto',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#111827', marginBottom: 8 }}>
          Registration Successful
        </h1>
        <p style={{ color: '#6b7280', marginBottom: 24 }}>
          Your account has been created. You can now log in.
        </p>
        <a
          href="#/"
          style={{
            display: 'inline-block',
            padding: '10px 16px',
            borderRadius: 8,
            backgroundColor: '#2563eb',
            color: '#ffffff',
            textDecoration: 'none',
            fontWeight: 600,
          }}
        >
          Go to Login
        </a>
      </div>
    </div>
  )
}
