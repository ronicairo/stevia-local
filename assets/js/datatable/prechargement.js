document.addEventListener('DOMContentLoaded', function () {
    const btn_precharge_filtre = document.querySelectorAll('.btn-precharge-filtre');

    btn_precharge_filtre.forEach(btn => {
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            const filtre = btn.getAttribute('data-precharge-filtre')
            const table_name = btn.getAttribute('data-target')

            filters[table_name] = {}

            filters[table_name]['numeroReference'] = {
                value: `${filtre}`,
                operator: '=',
                type: 'list'
            }

            localStorage.setItem('filters', JSON.stringify(filters))

            window.location.href = btn.href
        })
    })
})