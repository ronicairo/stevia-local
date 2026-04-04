document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.btn-delete-by-string').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.preventDefault()
            window.confirm(`Êtes-vous sûr de vouloir supprimer cet élément ?`)
                .then(response => {
                    if(response){
                        location.href = btn.href
                    }
                });

        })
    })
})