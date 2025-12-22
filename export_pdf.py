#!/usr/bin/env python3
"""
PDF Export Script for Software Copyright Documentation
Converts Markdown files to PDF with embedded images
"""

import os
import sys
import subprocess
import argparse
from pathlib import Path

def check_dependencies():
    """Check if required dependencies are installed"""
    # Check pandoc
    try:
        subprocess.run(['pandoc', '--version'], capture_output=True, check=True)
        print("✓ pandoc is installed")
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("✗ pandoc is not installed")
        print("Installation: brew install pandoc")
        return False
    
    # Check for PDF engines
    pdf_engines = ['pdflatex', 'xelatex', 'lualatex']
    available_engines = []
    
    for engine in pdf_engines:
        try:
            subprocess.run([engine, '--version'], capture_output=True, check=True)
            available_engines.append(engine)
            print(f"✓ {engine} is available")
        except (subprocess.CalledProcessError, FileNotFoundError):
            print(f"✗ {engine} is not available")
    
    if not available_engines:
        print("\nNo PDF engines found. Installing BasicTeX...")
        try:
            subprocess.run(['brew', 'install', '--cask', 'basictex'], check=True)
            print("✓ BasicTeX installed")
            return True
        except subprocess.CalledProcessError:
            print("✗ Failed to install BasicTeX")
            return False
    
    return True

def convert_md_to_pdf_pandoc(input_file, output_file):
    """Convert Markdown to PDF using pandoc with LaTeX engine"""
    try:
        # Get the directory of the input file for relative image paths
        input_dir = Path(input_file).parent
        
        # Try different PDF engines in order of preference
        engines = ['xelatex', 'pdflatex', 'lualatex']
        
        for engine in engines:
            try:
                subprocess.run([engine, '--version'], capture_output=True, check=True)
                print(f"Using PDF engine: {engine}")
                
                cmd = [
                    'pandoc',
                    str(input_file),
                    '-o', str(output_file),
                    f'--pdf-engine={engine}',
                    f'--resource-path={input_dir}',
                    '--toc',
                    '--toc-depth=3',
                    '--number-sections',
                    '--highlight-style=pygments',
                    '--variable', 'geometry:margin=2cm',
                    '--variable', 'fontsize=12pt',
                    '--variable', 'documentclass=article',
                    '--variable', 'CJKmainfont=PingFang SC',  # Chinese font for macOS
                    '--variable', 'lang=zh-CN'
                ]
                
                print(f"Converting {input_file} to {output_file}...")
                print(f"Command: {' '.join(cmd)}")
                
                result = subprocess.run(cmd, capture_output=True, text=True, cwd=input_dir)
                
                if result.returncode == 0:
                    print(f"✓ Successfully converted to {output_file}")
                    return True
                else:
                    print(f"✗ Conversion failed with {engine}:")
                    print(f"STDERR: {result.stderr}")
                    continue
                    
            except (subprocess.CalledProcessError, FileNotFoundError):
                continue
        
        print("✗ All PDF engines failed")
        return False
            
    except Exception as e:
        print(f"✗ Error during conversion: {e}")
        return False

def convert_md_to_html_only(input_file, output_file):
    """Convert Markdown to HTML with embedded images"""
    try:
        input_path = Path(input_file)
        input_dir = input_path.parent
        html_file = output_file.with_suffix('.html') if output_file.suffix == '.pdf' else output_file
        
        # Create CSS file for HTML
        create_css_file()
        
        # Convert MD to HTML with pandoc
        html_cmd = [
            'pandoc',
            str(input_file),
            '-o', str(html_file),
            '--embed-resources',
            '--standalone',
            f'--resource-path={input_dir}',
            '--css', 'pdf-style.css',
            '--toc',
            '--toc-depth=3',
            '--number-sections',
            '--highlight-style=pygments',
            '--variable', 'lang=zh-CN',
            '--metadata', 'title="萌姨萌嫂用户认证管理系统 - 用户手册"'
        ]
        
        print(f"Converting {input_file} to HTML...")
        result = subprocess.run(html_cmd, capture_output=True, text=True, cwd=input_dir)
        
        if result.returncode != 0:
            print(f"✗ HTML conversion failed:")
            print(f"STDERR: {result.stderr}")
            return False
        
        print(f"✓ HTML file created: {html_file}")
        print("Note: You can open this HTML file in a browser and print to PDF")
        
        # Clean up CSS file
        if Path('pdf-style.css').exists():
            Path('pdf-style.css').unlink()
            
        return True
            
    except Exception as e:
        print(f"✗ Error during conversion: {e}")
        return False

def create_css_file():
    """Create a CSS file for better PDF styling"""
    css_content = """
/* PDF Styling for Chinese Documentation */
body {
    font-family: "SimSun", "宋体", serif;
    font-size: 12pt;
    line-height: 1.6;
    color: #333;
    max-width: none;
}

h1, h2, h3, h4, h5, h6 {
    font-family: "SimHei", "黑体", sans-serif;
    color: #2c3e50;
    page-break-after: avoid;
}

h1 {
    font-size: 24pt;
    border-bottom: 3px solid #3498db;
    padding-bottom: 10px;
    page-break-before: always;
}

h2 {
    font-size: 18pt;
    border-bottom: 2px solid #3498db;
    padding-bottom: 5px;
    margin-top: 30px;
}

h3 {
    font-size: 16pt;
    color: #34495e;
    margin-top: 25px;
}

h4 {
    font-size: 14pt;
    color: #34495e;
    margin-top: 20px;
}

/* Table styling */
table {
    border-collapse: collapse;
    width: 100%;
    margin: 20px 0;
    page-break-inside: avoid;
}

th, td {
    border: 1px solid #ddd;
    padding: 8px;
    text-align: left;
}

th {
    background-color: #f8f9fa;
    font-weight: bold;
}

/* Image styling */
img {
    max-width: 100%;
    height: auto;
    display: block;
    margin: 20px auto;
    border: 1px solid #ddd;
    border-radius: 4px;
    page-break-inside: avoid;
}

/* Figure caption styling */
p strong {
    color: #2c3e50;
    font-size: 11pt;
}

/* Code styling */
code {
    background-color: #f8f9fa;
    padding: 2px 4px;
    border-radius: 3px;
    font-family: "Courier New", monospace;
    font-size: 10pt;
}

pre {
    background-color: #f8f9fa;
    padding: 15px;
    border-radius: 5px;
    border-left: 4px solid #3498db;
    overflow-x: auto;
    page-break-inside: avoid;
}

/* List styling */
ul, ol {
    margin: 10px 0;
    padding-left: 30px;
}

li {
    margin: 5px 0;
}

/* Page breaks */
.page-break {
    page-break-before: always;
}

/* Print-specific styles */
@media print {
    body {
        font-size: 11pt;
    }
    
    h1 {
        font-size: 20pt;
    }
    
    h2 {
        font-size: 16pt;
    }
    
    h3 {
        font-size: 14pt;
    }
    
    img {
        max-height: 400px;
    }
}
"""
    
    with open('pdf-style.css', 'w', encoding='utf-8') as f:
        f.write(css_content)
    print("✓ Created CSS styling file")

def main():
    parser = argparse.ArgumentParser(description='Convert Markdown to PDF/HTML with images')
    parser.add_argument('input', help='Input Markdown file')
    parser.add_argument('-o', '--output', help='Output file (optional)')
    parser.add_argument('--method', choices=['pandoc', 'html'], default='pandoc',
                       help='Conversion method (default: pandoc)')
    
    args = parser.parse_args()
    
    # Check if input file exists
    input_file = Path(args.input)
    if not input_file.exists():
        print(f"✗ Input file not found: {input_file}")
        return 1
    
    # Determine output file
    if args.output:
        output_file = Path(args.output)
    else:
        output_file = input_file.with_suffix('.pdf')
    
    print(f"Input file: {input_file}")
    print(f"Output file: {output_file}")
    print(f"Method: {args.method}")
    print("-" * 50)
    
    # Check dependencies
    if not check_dependencies():
        print("Falling back to HTML conversion...")
        args.method = 'html'
    
    # Convert based on method
    if args.method == 'pandoc':
        success = convert_md_to_pdf_pandoc(input_file, output_file)
        if not success:
            print("PDF conversion failed, trying HTML fallback...")
            success = convert_md_to_html_only(input_file, output_file)
    else:
        success = convert_md_to_html_only(input_file, output_file)
    
    if success:
        print(f"\n✓ Export completed successfully!")
        print(f"Output: {output_file}")
        return 0
    else:
        print(f"\n✗ Export failed!")
        return 1

if __name__ == '__main__':
    sys.exit(main())