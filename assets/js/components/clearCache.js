const clearBrowserCache = () => {
    for (let key in localStorage) {
        if (key.includes('DataTables_', 0)) localStorage.removeItem(key)
    }
    localStorage.removeItem('filters')
}

document.addEventListener('DOMContentLoaded', () => {
    clearBrowserCache()
    setTimeout(() => {
        window.location = Routing.generate('app_index')
    }, 3000)
})