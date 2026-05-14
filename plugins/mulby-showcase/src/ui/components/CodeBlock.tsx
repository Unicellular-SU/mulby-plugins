interface CodeBlockProps {
    children: string
    language?: string
}

export function CodeBlock({ children }: CodeBlockProps) {
    return (
        <pre className="code-block">
            <code>{children}</code>
        </pre>
    )
}
