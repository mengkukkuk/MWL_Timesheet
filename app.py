from app import app

if __name__ == '__main__':
    import os

    port = int(os.getenv('PORT', 5123))
    app.run(
        debug=os.getenv('FLASK_DEBUG', 'false').lower() == 'true',
        port=port,
        host='0.0.0.0',
    )
