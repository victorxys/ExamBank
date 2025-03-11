from flask import Flask

app = Flask(__name__)

@app.route('/')
def hello_world():
    import sys
    return f'Hello from Virtual Env: {sys.executable}'

if __name__ == '__main__':
    app.run(debug=True)
